/**
 * Realistic demo data for a camera department.
 *
 * Writes go straight to the tables (to control timestamps), but every
 * state change still produces the audit events a service would write, so timelines
 * in the UI look like real usage. The deferred assignment-consistency trigger is
 * satisfied because everything runs in one transaction.
 */
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Database, DbOrTx } from "../client";
import * as s from "../schema";
import type { AuditAction, AuditChanges } from "../schema";

type Tx = DbOrTx;
type UserKey = "alex" | "mira" | "jonas" | "sam";

const at = (iso: string) => new Date(iso);

/** Password for all demo accounts (development only). */
export const DEMO_PASSWORD = "camera-demo";

export interface SeedResult {
  workspaceId: string;
  userIds: Record<string, string>;
  projectIds: Record<string, string>;
}

export async function seedDemo(db: Database): Promise<SeedResult> {
  return db.transaction(async (tx) => new DemoSeeder(tx).run());
}

class DemoSeeder {
  private ws = "";
  private users = {} as Record<UserKey, string>;
  private projects: Record<string, string> = {};
  private rh: Record<string, string> = {};
  private cat: Record<string, string> = {};
  private types: Record<string, { id: string; name: string; tracking: "serialized" | "bulk" }> = {};
  private names = new Map<string, string>();

  constructor(private tx: Tx) {}

  async run(): Promise<SeedResult> {
    await this.workspaceAndUsers();
    await this.rentalHouses();
    await this.categories();
    await this.equipmentTypes();
    const templateId = await this.caseTemplates();
    await this.projectsAndInventory(templateId);
    return { workspaceId: this.ws, userIds: this.users, projectIds: this.projects };
  }

  // ---------------------------------------------------------------------------
  // Audit helper
  // ---------------------------------------------------------------------------
  private async ev(e: {
    action: AuditAction;
    entityType: string;
    entityId: string;
    summary: string;
    occurredAt: Date;
    actor?: string;
    actorType?: "user" | "system" | "ai";
    projectId?: string | null;
    equipmentItemId?: string | null;
    caseId?: string | null;
    documentId?: string | null;
    issueId?: string | null;
    rentalHouseId?: string | null;
    changes?: AuditChanges;
    metadata?: Record<string, unknown>;
    correlationId?: string;
  }) {
    const actorType = e.actorType ?? "user";
    await this.tx.insert(s.auditEvent).values({
      workspaceId: this.ws,
      occurredAt: e.occurredAt,
      actorType,
      actorUserId: actorType === "user" ? (e.actor ?? this.users.alex) : null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      summary: e.summary,
      projectId: e.projectId ?? null,
      equipmentItemId: e.equipmentItemId ?? null,
      caseId: e.caseId ?? null,
      documentId: e.documentId ?? null,
      issueId: e.issueId ?? null,
      rentalHouseId: e.rentalHouseId ?? null,
      changes: e.changes ?? null,
      metadata: e.metadata ?? null,
      correlationId: e.correlationId ?? null,
    });
  }

  // ---------------------------------------------------------------------------
  // Workspace, users
  // ---------------------------------------------------------------------------
  private async workspaceAndUsers() {
    const [w] = await this.tx
      .insert(s.workspace)
      .values({ name: "Nordlicht Camera Department", slug: "nordlicht" })
      .returning();
    this.ws = w!.id;

    const people = [
      { key: "alex", name: "Alex Brandt", email: "alex@nordlicht.example", role: "owner" as const },
      { key: "mira", name: "Mira Okafor", email: "mira@nordlicht.example", role: "admin" as const },
      { key: "jonas", name: "Jonas Weber", email: "jonas@nordlicht.example", role: "member" as const },
      { key: "sam", name: "Sam Lindqvist", email: "sam@nordlicht.example", role: "viewer" as const },
    ];
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    for (const p of people) {
      const [u] = await this.tx
        .insert(s.user)
        .values({ name: p.name, email: p.email, emailVerified: true })
        .returning();
      this.users[p.key as UserKey] = u!.id;
      await this.tx.insert(s.workspaceMember).values({ workspaceId: this.ws, userId: u!.id, role: p.role });
      // Better Auth email/password credential.
      await this.tx.insert(s.account).values({ userId: u!.id, accountId: u!.id, providerId: "credential", password: passwordHash });
    }
  }

  // ---------------------------------------------------------------------------
  // Catalog
  // ---------------------------------------------------------------------------
  private async rentalHouses() {
    const houses = [
      {
        key: "arri",
        name: "ARRI Rental",
        shortName: "ARRI",
        aliases: ["ARRI Rental Deutschland GmbH", "ARRI Rental Berlin", "Arri Rental"],
        website: "https://www.arrirental.com",
        phone: "+49 30 0000 1000",
      },
      { key: "mbf", name: "MBF Filmtechnik", shortName: "MBF", aliases: ["MBF", "M.B.F. Filmtechnik"], phone: "+49 89 0000 2000" },
      { key: "marek", name: "Marek Grip & Support", shortName: "Marek", aliases: ["Marek", "Marek Grip"], phone: "+49 40 0000 3000" },
      { key: "vantage", name: "Vantage Film", shortName: "Vantage", aliases: ["Vantage Film GmbH"], phone: "+49 961 0000 400" },
    ];
    for (const h of houses) {
      const { key, ...values } = h;
      const [row] = await this.tx.insert(s.rentalHouse).values({ workspaceId: this.ws, ...values }).returning();
      this.rh[key] = row!.id;
      await this.ev({
        action: "rental_house.created",
        entityType: "rental_house",
        entityId: row!.id,
        rentalHouseId: row!.id,
        summary: `Rental house ${h.name} created`,
        occurredAt: at("2026-05-20T09:00:00Z"),
      });
    }
  }

  private async categories() {
    const tree: Record<string, string[]> = {
      Camera: ["Camera Bodies", "Viewfinders", "Camera Accessories", "Video Assist"],
      Lenses: ["Spherical", "Anamorphic", "Zoom"],
      Support: ["Tripods", "Heads", "Gimbals"],
      Electronics: ["Monitors", "Wireless", "Timecode", "Lens Control"],
      Power: ["Batteries", "Chargers"],
      Grip: ["Stands", "Rigging", "Weights"],
      Cables: ["Video Cables", "Power Cables"],
    };
    let rootOrder = 0;
    for (const [root, children] of Object.entries(tree)) {
      const [r] = await this.tx
        .insert(s.category)
        .values({ workspaceId: this.ws, name: root, sortOrder: rootOrder++ })
        .returning();
      this.cat[root] = r!.id;
      let order = 0;
      for (const child of children) {
        const [c] = await this.tx
          .insert(s.category)
          .values({ workspaceId: this.ws, parentId: r!.id, name: child, sortOrder: order++ })
          .returning();
        this.cat[child] = c!.id;
      }
    }
  }

  private async equipmentTypes() {
    const T = (
      key: string,
      manufacturer: string,
      model: string,
      category: string,
      opts: { aliases?: string[]; specs?: Record<string, unknown>; bulk?: boolean; name?: string } = {},
    ) => ({ key, manufacturer, model, category, ...opts });

    const list = [
      T("alexa35", "ARRI", "ALEXA 35", "Camera Bodies", {
        aliases: ["Alexa35", "ALEXA35", "A35", "Arri Alexa 35 Camera Set"],
        specs: { sensor: "Super 35 4.6K", mount: "LPL", weight_kg: 2.9, power: "24V / 12V" },
      }),
      T("minilf", "ARRI", "ALEXA Mini LF", "Camera Bodies", {
        aliases: ["Mini LF", "AMLF", "Alexa MiniLF"],
        specs: { sensor: "Large Format 4.5K", mount: "LPL", weight_kg: 2.6 },
      }),
      T("mvf2", "ARRI", "MVF-2", "Viewfinders", { aliases: ["MVF2", "Multi Viewfinder MVF-2", "EVF"], name: "ARRI MVF-2 Multi Viewfinder" }),
      T("evfcable", "ARRI", "VF Cable KC-150-S", "Camera Accessories", { aliases: ["EVF Cable", "MVF Cable", "KC150"], name: "ARRI EVF Cable" }),
      T("tophandle", "ARRI", "Top Handle TH-35", "Camera Accessories", { aliases: ["Top Handle", "Handle"], name: "ARRI Top Handle" }),
      T("baseplate", "ARRI", "Base Plate BP-35", "Camera Accessories", { aliases: ["Baseplate", "Bridge Plate"], name: "ARRI Baseplate" }),
      T("wcu4", "ARRI", "WCU-4", "Lens Control", { aliases: ["WCU4", "Hi-5 predecessor", "Wireless Compact Unit"] }),
      T("cforce", "ARRI", "cforce mini", "Lens Control", { aliases: ["CForce Mini", "Lens Motor"] }),
      T("battery", "bebob", "B290cine", "Batteries", {
        aliases: ["B290", "B-Mount Battery", "Bebob B290 Cine"],
        specs: { mount: "B-Mount", capacity_wh: 290, voltage: "24V/12V" },
      }),
      T("charger", "bebob", "VS2-Cine Charger", "Chargers", { aliases: ["B-Mount Charger"] }),
      T("sp25", "ARRI", "Signature Prime 25mm T1.8", "Spherical", { aliases: ["SP25", "Sig Prime 25"] }),
      T("sp35", "ARRI", "Signature Prime 35mm T1.8", "Spherical", { aliases: ["SP35", "Sig Prime 35"] }),
      T("sp50", "ARRI", "Signature Prime 50mm T1.8", "Spherical", { aliases: ["SP50", "Sig Prime 50"] }),
      T("sp75", "ARRI", "Signature Prime 75mm T1.8", "Spherical", { aliases: ["SP75", "Sig Prime 75"] }),
      T("optimo", "Angénieux", "Optimo 24-290", "Zoom", { aliases: ["Optimo 24-290 T2.8", "Angenieux 24-290", "Optimo 12x"] }),
      T("bolttx", "Teradek", "Bolt 6 XT 750 TX", "Wireless", { aliases: ["Bolt 6 TX", "Teradek TX", "Bolt750 TX"] }),
      T("boltrx", "Teradek", "Bolt 6 XT 750 RX", "Wireless", { aliases: ["Bolt 6 RX", "Teradek RX", "Bolt750 RX"] }),
      T("cine7", "SmallHD", "Cine 7", "Monitors", { aliases: ["SmallHD 7", "Cine7", "Small HD Cine 7"] }),
      T("oconnor", "OConnor", "2575D Fluid Head", "Heads", { aliases: ["O'Connor 2575", "2575D", "OConnor 2575"], name: "O'Connor 2575D" }),
      T("legs", "OConnor", "Cine HD Tripod Legs", "Tripods", { aliases: ["Tripod", "Sticks", "Standard Legs"], name: "O'Connor Cine HD Tripod" }),
      T("tentacle", "Tentacle Sync", "Tentacle Sync E", "Timecode", { aliases: ["Tentacle", "TC Box"] }),
      T("cstand", "Avenger", "C-Stand 40\"", "Stands", { aliases: ["C Stand", "Century Stand"], bulk: true }),
      T("sandbag", "Matthews", "Sandbag 15 lb", "Weights", { aliases: ["Shot Bag", "Sand Bag"], bulk: true }),
      T("bnc", "Generic", "3G-SDI BNC Cable 1 m", "Video Cables", { aliases: ["BNC 1m", "SDI Cable"], bulk: true, name: "BNC Cable 1 m" }),
    ];
    for (const t of list) {
      const name = t.name ?? `${t.manufacturer} ${t.model}`;
      const [row] = await this.tx
        .insert(s.equipmentType)
        .values({
          workspaceId: this.ws,
          categoryId: this.cat[t.category]!,
          manufacturer: t.manufacturer,
          model: t.model,
          name,
          aliases: t.aliases ?? [],
          specs: t.specs ?? {},
          defaultTrackingMode: t.bulk ? "bulk" : "serialized",
        })
        .returning();
      this.types[t.key] = { id: row!.id, name, tracking: t.bulk ? "bulk" : "serialized" };
      await this.ev({
        action: "equipment_type.created",
        entityType: "equipment_type",
        entityId: row!.id,
        summary: `Equipment type ${name} created`,
        occurredAt: at("2026-05-20T09:30:00Z"),
      });
    }
  }

  private async caseTemplates(): Promise<string> {
    const [tpl] = await this.tx
      .insert(s.caseTemplate)
      .values({ workspaceId: this.ws, name: "A-Cam Set", description: "Standard camera body set for an ALEXA 35 build" })
      .returning();
    const lines: [string, string, number][] = [
      ["alexa35", "ALEXA 35", 1],
      ["mvf2", "MVF-2", 1],
      ["tophandle", "Top Handle", 1],
      ["baseplate", "Baseplate", 1],
      ["evfcable", "EVF Cable", 1],
      ["battery", "Batteries", 2],
      ["bolttx", "Teradek Bolt TX", 1],
    ];
    let i = 0;
    for (const [key, label, quantity] of lines) {
      await this.tx.insert(s.caseTemplateItem).values({
        workspaceId: this.ws,
        templateId: tpl!.id,
        equipmentTypeId: this.types[key]!.id,
        label,
        quantity,
        sortOrder: i++,
      });
    }
    const [lensTpl] = await this.tx
      .insert(s.caseTemplate)
      .values({ workspaceId: this.ws, name: "Prime Lens Set", description: "Four-lens prime set" })
      .returning();
    await this.tx.insert(s.caseTemplateItem).values({
      workspaceId: this.ws,
      templateId: lensTpl!.id,
      categoryId: this.cat["Spherical"]!,
      label: "Spherical primes",
      quantity: 4,
    });
    await this.ev({
      action: "case_template.created",
      entityType: "case_template",
      entityId: tpl!.id,
      summary: "Set template “A-Cam Set” created",
      occurredAt: at("2026-05-21T10:00:00Z"),
    });
    return tpl!.id;
  }

  // ---------------------------------------------------------------------------
  // Inventory helpers (mirror what the Phase 3+ services will do)
  // ---------------------------------------------------------------------------
  private async createProject(key: string, values: Omit<typeof s.project.$inferInsert, "workspaceId">, when: Date) {
    const [p] = await this.tx.insert(s.project).values({ workspaceId: this.ws, ...values }).returning();
    this.projects[key] = p!.id;
    await this.ev({
      action: "project.created",
      entityType: "project",
      entityId: p!.id,
      projectId: p!.id,
      summary: `Project ${values.name} created`,
      occurredAt: when,
    });
    return p!.id;
  }

  private async linkRentalHouse(projectId: string, rhKey: string, orderReference: string, contactName: string, when: Date) {
    await this.tx.insert(s.projectRentalHouse).values({
      workspaceId: this.ws,
      projectId,
      rentalHouseId: this.rh[rhKey]!,
      orderReference,
      contactName,
    });
    await this.ev({
      action: "rental_house.linked_to_project",
      entityType: "rental_house",
      entityId: this.rh[rhKey]!,
      rentalHouseId: this.rh[rhKey]!,
      projectId,
      summary: `Rental house linked to project (order ${orderReference})`,
      occurredAt: when,
    });
  }

  private async createDocument(values: {
    kind: "delivery_note" | "return_note";
    projectId: string;
    rhKey: string;
    documentNumber: string;
    documentDate: string;
    confirmedAt?: Date;
    status?: "extracted" | "confirmed";
    actor?: string;
  }) {
    const status = values.status ?? "confirmed";
    const [doc] = await this.tx
      .insert(s.document)
      .values({
        workspaceId: this.ws,
        kind: values.kind,
        status,
        projectId: values.projectId,
        rentalHouseId: this.rh[values.rhKey]!,
        documentNumber: values.documentNumber,
        documentDate: values.documentDate,
        title: `${values.kind === "delivery_note" ? "Delivery" : "Return"} ${values.documentNumber}`,
        extractionProvider: "mock",
        extractionModel: "mock-extractor-v1",
        extractedAt: at(`${values.documentDate}T12:00:00Z`),
        uploadedById: values.actor ?? this.users.mira,
        confirmedById: status === "confirmed" ? (values.actor ?? this.users.mira) : null,
        confirmedAt: status === "confirmed" ? (values.confirmedAt ?? at(`${values.documentDate}T15:00:00Z`)) : null,
      })
      .returning();
    await this.ev({
      action: "document.uploaded",
      entityType: "document",
      entityId: doc!.id,
      documentId: doc!.id,
      projectId: values.projectId,
      rentalHouseId: this.rh[values.rhKey]!,
      actor: values.actor ?? this.users.mira,
      summary: `${values.kind === "delivery_note" ? "Delivery note" : "Return note"} ${values.documentNumber} uploaded`,
      occurredAt: at(`${values.documentDate}T11:55:00Z`),
    });
    await this.ev({
      action: "document.extracted",
      entityType: "document",
      entityId: doc!.id,
      documentId: doc!.id,
      projectId: values.projectId,
      actorType: "ai",
      summary: `Document ${values.documentNumber} read by extraction service`,
      metadata: { provider: "mock", model: "mock-extractor-v1" },
      occurredAt: at(`${values.documentDate}T12:00:00Z`),
    });
    return doc!.id;
  }

  private lineNo = new Map<string, number>();
  private async addLine(
    documentId: string,
    v: {
      description: string;
      quantity: number;
      serialNumber?: string | null;
      assetNumber?: string | null;
      typeKey?: string;
      itemId?: string;
      resolution: "pending" | "match_existing" | "create_new" | "ignore" | "discrepancy";
      matchConfidence?: number;
      matchReason?: string;
    },
  ) {
    const n = (this.lineNo.get(documentId) ?? 0) + 1;
    this.lineNo.set(documentId, n);
    await this.tx.insert(s.documentLine).values({
      workspaceId: this.ws,
      documentId,
      lineNumber: n,
      rawText: `${v.quantity} x ${v.description}${v.serialNumber ? ` SN ${v.serialNumber}` : ""}`,
      description: v.description,
      quantity: v.quantity,
      serialNumber: v.serialNumber ?? null,
      assetNumber: v.assetNumber ?? null,
      aiConfidence: 0.93,
      matchedEquipmentTypeId: v.typeKey ? this.types[v.typeKey]!.id : null,
      matchedEquipmentItemId: v.itemId ?? null,
      matchConfidence: v.matchConfidence ?? (v.typeKey ? 0.9 : null),
      matchReason: v.matchReason ?? (v.serialNumber ? "serial number match" : v.typeKey ? "alias match" : null),
      resolution: v.resolution,
      confirmedQuantity: v.resolution === "pending" ? null : v.quantity,
    });
  }

  /** Create (or reuse) an item and assign it to a project via a delivery note. */
  private async deliver(o: {
    typeKey: string;
    projectId: string;
    rhKey: string;
    documentId: string;
    when: Date;
    correlationId: string;
    serialNumber?: string;
    assetNumber?: string;
    barcode?: string;
    quantity?: number;
    existingItemId?: string;
    condition?: "ok" | "minor_wear";
  }): Promise<string> {
    const type = this.types[o.typeKey]!;
    const quantity = o.quantity ?? 1;
    let itemId = o.existingItemId;
    const label =
      (itemId && this.names.get(itemId)) ||
      `${type.name}${o.serialNumber ? ` (SN ${o.serialNumber})` : quantity > 1 ? ` × ${quantity}` : ""}`;
    if (itemId) {
      await this.tx
        .update(s.equipmentItem)
        .set({ projectId: o.projectId, status: "on_project", condition: o.condition ?? "ok" })
        .where(eq(s.equipmentItem.id, itemId));
    } else {
      const [item] = await this.tx
        .insert(s.equipmentItem)
        .values({
          workspaceId: this.ws,
          equipmentTypeId: type.id,
          trackingMode: type.tracking,
          quantity,
          serialNumber: o.serialNumber ?? null,
          assetNumber: o.assetNumber ?? null,
          barcode: o.barcode ?? null,
          rentalHouseId: this.rh[o.rhKey]!,
          projectId: o.projectId,
          status: "on_project",
          condition: o.condition ?? "ok",
          createdAt: o.when,
          updatedAt: o.when,
        })
        .returning();
      itemId = item!.id;
      await this.ev({
        action: "equipment_item.created",
        entityType: "equipment_item",
        entityId: itemId,
        equipmentItemId: itemId,
        documentId: o.documentId,
        rentalHouseId: this.rh[o.rhKey]!,
        projectId: o.projectId,
        summary: `${label} created from delivery note`,
        occurredAt: o.when,
        correlationId: o.correlationId,
      });
    }
    this.names.set(itemId, label);
    await this.tx.insert(s.projectAssignment).values({
      workspaceId: this.ws,
      equipmentItemId: itemId,
      projectId: o.projectId,
      rentalHouseId: this.rh[o.rhKey]!,
      quantity,
      deliveryDocumentId: o.documentId,
      assignedAt: o.when,
      assignedById: this.users.mira,
    });
    await this.ev({
      action: "equipment_item.assigned_to_project",
      entityType: "equipment_item",
      entityId: itemId,
      equipmentItemId: itemId,
      projectId: o.projectId,
      documentId: o.documentId,
      rentalHouseId: this.rh[o.rhKey]!,
      actor: this.users.mira,
      summary: `${label} received on project`,
      changes: { status: { from: o.existingItemId ? "returned" : null, to: "on_project" }, project_id: { from: null, to: o.projectId } },
      occurredAt: o.when,
      correlationId: o.correlationId,
    });
    return itemId;
  }

  private async putInCase(itemId: string, caseId: string, projectId: string, when: Date, actor = this.users.jonas) {
    await this.tx.update(s.equipmentItem).set({ caseId }).where(eq(s.equipmentItem.id, itemId));
    await this.ev({
      action: "equipment_item.added_to_case",
      entityType: "equipment_item",
      entityId: itemId,
      equipmentItemId: itemId,
      caseId,
      projectId,
      actor,
      summary: `${this.names.get(itemId)} packed into set`,
      changes: { case_id: { from: null, to: caseId } },
      occurredAt: when,
    });
  }

  private async setStatus(itemId: string, projectId: string, from: string, to: "in_use" | "missing" | "ready_for_return", when: Date, actor = this.users.alex) {
    await this.tx.update(s.equipmentItem).set({ status: to }).where(eq(s.equipmentItem.id, itemId));
    await this.ev({
      action: "equipment_item.status_changed",
      entityType: "equipment_item",
      entityId: itemId,
      equipmentItemId: itemId,
      projectId,
      actor,
      summary: `${this.names.get(itemId)}: ${from.replaceAll("_", " ")} → ${to.replaceAll("_", " ")}`,
      changes: { status: { from, to } },
      occurredAt: when,
    });
  }

  private async returnItem(o: {
    itemId: string;
    projectId: string;
    documentId: string;
    when: Date;
    correlationId: string;
    caseId?: string | null;
    fromStatus?: string;
  }) {
    await this.tx
      .update(s.equipmentItem)
      .set({ projectId: null, caseId: null, status: "returned" })
      .where(eq(s.equipmentItem.id, o.itemId));
    await this.tx
      .update(s.projectAssignment)
      .set({ endedAt: o.when, endedById: this.users.mira, endReason: "returned", returnDocumentId: o.documentId })
      .where(and(eq(s.projectAssignment.equipmentItemId, o.itemId), isNull(s.projectAssignment.endedAt)));
    if (o.caseId) {
      await this.ev({
        action: "equipment_item.removed_from_case",
        entityType: "equipment_item",
        entityId: o.itemId,
        equipmentItemId: o.itemId,
        caseId: o.caseId,
        projectId: o.projectId,
        documentId: o.documentId,
        actor: this.users.mira,
        summary: `${this.names.get(o.itemId)} unpacked for return`,
        changes: { case_id: { from: o.caseId, to: null } },
        occurredAt: o.when,
        correlationId: o.correlationId,
      });
    }
    await this.ev({
      action: "equipment_item.returned",
      entityType: "equipment_item",
      entityId: o.itemId,
      equipmentItemId: o.itemId,
      projectId: o.projectId,
      documentId: o.documentId,
      actor: this.users.mira,
      summary: `${this.names.get(o.itemId)} returned to rental house`,
      changes: {
        status: { from: o.fromStatus ?? "on_project", to: "returned" },
        project_id: { from: o.projectId, to: null },
      },
      occurredAt: o.when,
      correlationId: o.correlationId,
    });
  }

  private async createCase(o: { projectId: string; name: string; code: string; templateId?: string; when: Date; expected?: [string, string, number][] }) {
    const [c] = await this.tx
      .insert(s.equipmentCase)
      .values({
        workspaceId: this.ws,
        projectId: o.projectId,
        templateId: o.templateId ?? null,
        name: o.name,
        code: o.code,
        barcode: `CASE-${o.code.replaceAll(" ", "")}`,
      })
      .returning();
    let expected = o.expected;
    if (o.templateId) {
      const tplItems = await this.tx.query.caseTemplateItem.findMany({
        where: eq(s.caseTemplateItem.templateId, o.templateId),
      });
      for (const ti of tplItems) {
        await this.tx.insert(s.caseExpectedItem).values({
          workspaceId: this.ws,
          caseId: c!.id,
          equipmentTypeId: ti.equipmentTypeId,
          categoryId: ti.categoryId,
          label: ti.label,
          quantity: ti.quantity,
          sortOrder: ti.sortOrder,
        });
      }
      expected = undefined;
    }
    let i = 0;
    for (const [key, label, quantity] of expected ?? []) {
      await this.tx.insert(s.caseExpectedItem).values({
        workspaceId: this.ws,
        caseId: c!.id,
        equipmentTypeId: this.types[key]!.id,
        label,
        quantity,
        sortOrder: i++,
      });
    }
    await this.ev({
      action: "case.created",
      entityType: "case",
      entityId: c!.id,
      caseId: c!.id,
      projectId: o.projectId,
      actor: this.users.jonas,
      summary: `Set ${o.name} created${o.templateId ? " from template" : ""}`,
      occurredAt: o.when,
    });
    return c!.id;
  }

  private async createIssue(o: {
    type: (typeof s.issueType.enumValues)[number];
    severity: (typeof s.issueSeverity.enumValues)[number];
    title: string;
    description: string;
    projectId: string;
    itemId?: string;
    caseId?: string;
    documentId?: string;
    when: Date;
    actor?: string;
    resolved?: { at: Date; resolution: string; by: string };
  }) {
    const [i] = await this.tx
      .insert(s.issue)
      .values({
        workspaceId: this.ws,
        type: o.type,
        severity: o.severity,
        status: o.resolved ? "resolved" : "open",
        title: o.title,
        description: o.description,
        projectId: o.projectId,
        equipmentItemId: o.itemId ?? null,
        caseId: o.caseId ?? null,
        documentId: o.documentId ?? null,
        createdById: o.actor ?? this.users.alex,
        resolvedById: o.resolved?.by ?? null,
        resolvedAt: o.resolved?.at ?? null,
        resolution: o.resolved?.resolution ?? null,
        createdAt: o.when,
        updatedAt: o.resolved?.at ?? o.when,
      })
      .returning();
    await this.ev({
      action: "issue.created",
      entityType: "issue",
      entityId: i!.id,
      issueId: i!.id,
      projectId: o.projectId,
      equipmentItemId: o.itemId,
      caseId: o.caseId,
      documentId: o.documentId,
      actor: o.actor,
      summary: `Issue opened: ${o.title}`,
      occurredAt: o.when,
    });
    if (o.resolved) {
      await this.ev({
        action: "issue.resolved",
        entityType: "issue",
        entityId: i!.id,
        issueId: i!.id,
        projectId: o.projectId,
        equipmentItemId: o.itemId,
        actor: o.resolved.by,
        summary: `Issue resolved: ${o.title}`,
        changes: { status: { from: "open", to: "resolved" } },
        metadata: { resolution: o.resolved.resolution },
        occurredAt: o.resolved.at,
      });
    }
    return i!.id;
  }

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------
  private async projectsAndInventory(aCamTemplateId: string) {
    // ---- Past project: a commercial that has fully wrapped -------------------
    const ncc = await this.createProject(
      "commercial",
      { name: "Commercial — Nordic Coast", code: "NCC", status: "closed", productionCompany: "Fjord Pictures", startDate: "2026-06-02", endDate: "2026-06-12" },
      at("2026-05-25T08:00:00Z"),
    );
    await this.linkRentalHouse(ncc, "arri", "AR-2026-0512", "Lena Hoffmann", at("2026-05-25T08:10:00Z"));
    const nccCorr = randomUUID();
    const nccDel = await this.createDocument({ kind: "delivery_note", projectId: ncc, rhKey: "arri", documentNumber: "LS-240117", documentDate: "2026-06-02" });
    const nccWhen = at("2026-06-02T15:00:00Z");
    const alexaA = await this.deliver({ typeKey: "alexa35", projectId: ncc, rhKey: "arri", documentId: nccDel, when: nccWhen, correlationId: nccCorr, serialNumber: "35-10421", assetNumber: "AR-A35-0042", barcode: "ARRI-0042" });
    const nccMvf = await this.deliver({ typeKey: "mvf2", projectId: ncc, rhKey: "arri", documentId: nccDel, when: nccWhen, correlationId: nccCorr, serialNumber: "MVF-77812" });
    await this.addLine(nccDel, { description: "ALEXA 35 Camera Body", quantity: 1, serialNumber: "35-10421", assetNumber: "AR-A35-0042", typeKey: "alexa35", itemId: alexaA, resolution: "create_new" });
    await this.addLine(nccDel, { description: "MVF-2 Viewfinder", quantity: 1, serialNumber: "MVF-77812", typeKey: "mvf2", itemId: nccMvf, resolution: "create_new" });
    await this.ev({ action: "delivery.imported", entityType: "document", entityId: nccDel, documentId: nccDel, projectId: ncc, actor: this.users.mira, summary: "Delivery LS-240117 confirmed: 2 items received", occurredAt: nccWhen, correlationId: nccCorr });

    const nccRetCorr = randomUUID();
    const nccRet = await this.createDocument({ kind: "return_note", projectId: ncc, rhKey: "arri", documentNumber: "RT-240133", documentDate: "2026-06-12" });
    const nccRetWhen = at("2026-06-12T15:00:00Z");
    await this.addLine(nccRet, { description: "ALEXA 35 Camera Body", quantity: 1, serialNumber: "35-10421", typeKey: "alexa35", itemId: alexaA, resolution: "match_existing", matchConfidence: 1 });
    await this.addLine(nccRet, { description: "MVF-2 Viewfinder", quantity: 1, serialNumber: "MVF-77812", typeKey: "mvf2", itemId: nccMvf, resolution: "match_existing", matchConfidence: 1 });
    await this.returnItem({ itemId: alexaA, projectId: ncc, documentId: nccRet, when: nccRetWhen, correlationId: nccRetCorr });
    await this.returnItem({ itemId: nccMvf, projectId: ncc, documentId: nccRet, when: nccRetWhen, correlationId: nccRetCorr });
    await this.ev({ action: "return_note.imported", entityType: "document", entityId: nccRet, documentId: nccRet, projectId: ncc, actor: this.users.mira, summary: "Return RT-240133 confirmed: 2 of 2 items returned", occurredAt: nccRetWhen, correlationId: nccRetCorr });

    // ---- Current feature film -----------------------------------------------
    const ffx = await this.createProject(
      "feature",
      { name: "Feature Film X", code: "FFX", status: "shooting", productionCompany: "Northern Light Pictures", startDate: "2026-08-25", endDate: "2026-11-14", description: "42 shooting days, two-camera show." },
      at("2026-08-10T09:00:00Z"),
    );
    await this.linkRentalHouse(ffx, "arri", "AR-2026-0874", "Lena Hoffmann", at("2026-08-10T09:05:00Z"));
    await this.linkRentalHouse(ffx, "mbf", "MBF-55120", "Tobias Kern", at("2026-08-10T09:06:00Z"));
    await this.linkRentalHouse(ffx, "marek", "MK-3391", "Petra Marek", at("2026-08-10T09:07:00Z"));

    // ARRI delivery — re-uses the ALEXA 35 that was on the commercial.
    const arriCorr = randomUUID();
    const arriDel = await this.createDocument({ kind: "delivery_note", projectId: ffx, rhKey: "arri", documentNumber: "LS-240388", documentDate: "2026-08-25" });
    const arriWhen = at("2026-08-25T15:00:00Z");
    const d = (o: Omit<Parameters<DemoSeeder["deliver"]>[0], "projectId" | "rhKey" | "documentId" | "when" | "correlationId">) =>
      this.deliver({ ...o, projectId: ffx, rhKey: "arri", documentId: arriDel, when: arriWhen, correlationId: arriCorr });

    const aBody = await d({ typeKey: "alexa35", existingItemId: alexaA });
    const bBody = await d({ typeKey: "alexa35", serialNumber: "35-10577", assetNumber: "AR-A35-0057", barcode: "ARRI-0057" });
    const aMvf = await d({ typeKey: "mvf2", serialNumber: "MVF-80144" });
    const bMvf = await d({ typeKey: "mvf2", serialNumber: "MVF-80151" });
    const aHandle = await d({ typeKey: "tophandle", serialNumber: "TH-2210" });
    const bHandle = await d({ typeKey: "tophandle", serialNumber: "TH-2214" });
    const aPlate = await d({ typeKey: "baseplate", serialNumber: "BP-5531" });
    const bPlate = await d({ typeKey: "baseplate", serialNumber: "BP-5536" });
    const aCable = await d({ typeKey: "evfcable", serialNumber: "KC-90017" });
    const bCable = await d({ typeKey: "evfcable", serialNumber: "KC-90022" });
    const batteries: string[] = [];
    for (const sn of ["B290-31104", "B290-31107", "B290-31115", "B290-31120", "B290-31126", "B290-31131"]) {
      batteries.push(await d({ typeKey: "battery", serialNumber: sn }));
    }
    const lenses: Record<string, string> = {};
    for (const [key, sn] of [["sp25", "SP25-1188"], ["sp35", "SP35-1203"], ["sp50", "SP50-1179"], ["sp75", "SP75-1094"]] as const) {
      lenses[key] = await d({ typeKey: key, serialNumber: sn, condition: key === "sp50" ? "minor_wear" : "ok" });
    }
    const wcu = await d({ typeKey: "wcu4", serialNumber: "WCU-4471" });
    const charger = await d({ typeKey: "charger", serialNumber: "VS2-0812" });
    for (const [desc, typeKey, sn, itemId] of [
      ["ALEXA 35", "alexa35", "35-10421", aBody],
      ["ALEXA 35", "alexa35", "35-10577", bBody],
      ["MVF-2", "mvf2", "MVF-80144", aMvf],
      ["MVF-2", "mvf2", "MVF-80151", bMvf],
      ["Signature Prime 25mm", "sp25", "SP25-1188", lenses.sp25],
      ["Signature Prime 35mm", "sp35", "SP35-1203", lenses.sp35],
      ["Signature Prime 50mm", "sp50", "SP50-1179", lenses.sp50],
      ["Signature Prime 75mm", "sp75", "SP75-1094", lenses.sp75],
    ] as const) {
      await this.addLine(arriDel, {
        description: desc,
        quantity: 1,
        serialNumber: sn,
        typeKey,
        itemId,
        resolution: itemId === aBody ? "match_existing" : "create_new",
        matchConfidence: itemId === aBody ? 1 : 0.92,
        matchReason: itemId === aBody ? "serial matches item returned from Commercial — Nordic Coast" : "alias match",
      });
    }
    await this.addLine(arriDel, { description: "B-Mount Battery bebob B290", quantity: 6, typeKey: "battery", resolution: "create_new", matchReason: "alias match; serials entered at check-in" });
    await this.ev({ action: "delivery.imported", entityType: "document", entityId: arriDel, documentId: arriDel, projectId: ffx, actor: this.users.mira, summary: "Delivery LS-240388 confirmed: 22 items received from ARRI Rental", occurredAt: arriWhen, correlationId: arriCorr });

    // MBF delivery — wireless video, monitors, bulk cables.
    const mbfCorr = randomUUID();
    const mbfDel = await this.createDocument({ kind: "delivery_note", projectId: ffx, rhKey: "mbf", documentNumber: "MBF-D-77310", documentDate: "2026-08-26" });
    const mbfWhen = at("2026-08-26T14:00:00Z");
    const m = (o: Omit<Parameters<DemoSeeder["deliver"]>[0], "projectId" | "rhKey" | "documentId" | "when" | "correlationId">) =>
      this.deliver({ ...o, projectId: ffx, rhKey: "mbf", documentId: mbfDel, when: mbfWhen, correlationId: mbfCorr });
    const aTx = await m({ typeKey: "bolttx", serialNumber: "TD6-TX-40112", assetNumber: "MBF-1101" });
    const bTx = await m({ typeKey: "bolttx", serialNumber: "TD6-TX-40118", assetNumber: "MBF-1102" });
    const rx1 = await m({ typeKey: "boltrx", serialNumber: "TD6-RX-40213", assetNumber: "MBF-1103" });
    const rx2 = await m({ typeKey: "boltrx", serialNumber: "TD6-RX-40219", assetNumber: "MBF-1104" });
    const mon1 = await m({ typeKey: "cine7", serialNumber: "C7-220871", assetNumber: "MBF-2201" });
    const mon2 = await m({ typeKey: "cine7", serialNumber: "C7-220874", assetNumber: "MBF-2202" });
    const mon3 = await m({ typeKey: "cine7", serialNumber: "C7-220880", assetNumber: "MBF-2203" });
    const bnc = await m({ typeKey: "bnc", quantity: 12 });
    await this.addLine(mbfDel, { description: "Teradek Bolt 6 XT 750 TX", quantity: 2, typeKey: "bolttx", resolution: "create_new" });
    await this.addLine(mbfDel, { description: "Teradek Bolt 6 XT 750 RX", quantity: 2, typeKey: "boltrx", resolution: "create_new" });
    await this.addLine(mbfDel, { description: "SmallHD Cine 7 Monitor", quantity: 3, typeKey: "cine7", resolution: "create_new" });
    await this.addLine(mbfDel, { description: "BNC 3G-SDI 1m", quantity: 12, typeKey: "bnc", itemId: bnc, resolution: "create_new" });
    await this.ev({ action: "delivery.imported", entityType: "document", entityId: mbfDel, documentId: mbfDel, projectId: ffx, actor: this.users.mira, summary: "Delivery MBF-D-77310 confirmed: 8 lines received from MBF Filmtechnik", occurredAt: mbfWhen, correlationId: mbfCorr });

    // Marek delivery — support and grip.
    const mkCorr = randomUUID();
    const mkDel = await this.createDocument({ kind: "delivery_note", projectId: ffx, rhKey: "marek", documentNumber: "MK-LS-1187", documentDate: "2026-08-26" });
    const mkWhen = at("2026-08-26T16:30:00Z");
    const head = await this.deliver({ typeKey: "oconnor", projectId: ffx, rhKey: "marek", documentId: mkDel, when: mkWhen, correlationId: mkCorr, serialNumber: "2575-18832" });
    const legs = await this.deliver({ typeKey: "legs", projectId: ffx, rhKey: "marek", documentId: mkDel, when: mkWhen, correlationId: mkCorr, serialNumber: "CHD-5521" });
    const sandbags = await this.deliver({ typeKey: "sandbag", projectId: ffx, rhKey: "marek", documentId: mkDel, when: mkWhen, correlationId: mkCorr, quantity: 10 });
    await this.addLine(mkDel, { description: "OConnor 2575 Head", quantity: 1, serialNumber: "2575-18832", typeKey: "oconnor", itemId: head, resolution: "create_new" });
    await this.addLine(mkDel, { description: "Tripod Standard Legs", quantity: 1, serialNumber: "CHD-5521", typeKey: "legs", itemId: legs, resolution: "create_new" });
    await this.addLine(mkDel, { description: "Sandsack 15lb", quantity: 10, typeKey: "sandbag", itemId: sandbags, resolution: "create_new", matchReason: "fuzzy match (Sandsack → Sandbag)" });
    await this.ev({ action: "delivery.imported", entityType: "document", entityId: mkDel, documentId: mkDel, projectId: ffx, actor: this.users.mira, summary: "Delivery MK-LS-1187 confirmed: 3 lines received from Marek Grip & Support", occurredAt: mkWhen, correlationId: mkCorr });

    // Cases
    const caseWhen = at("2026-08-27T09:00:00Z");
    const aCase = await this.createCase({ projectId: ffx, name: "A-Cam Set", code: "A-CAM 1", templateId: aCamTemplateId, when: caseWhen });
    const bCase = await this.createCase({ projectId: ffx, name: "B-Cam Set", code: "B-CAM 1", templateId: aCamTemplateId, when: caseWhen });
    const lensCase = await this.createCase({
      projectId: ffx,
      name: "Signature Primes",
      code: "LENS 1",
      when: caseWhen,
      expected: [["sp25", "25mm", 1], ["sp35", "35mm", 1], ["sp50", "50mm", 1], ["sp75", "75mm", 1]],
    });
    const videoCase = await this.createCase({
      projectId: ffx,
      name: "Video Village",
      code: "VIDEO 1",
      when: caseWhen,
      expected: [["boltrx", "Bolt RX", 2], ["cine7", "SmallHD Cine 7", 3], ["bnc", "BNC cables", 12]],
    });

    const packWhen = at("2026-08-27T11:00:00Z");
    // A-Cam: 7 of 8 expected — the second battery is in the charger, not the case.
    for (const id of [aBody, aMvf, aHandle, aPlate, aCable, batteries[0]!, aTx]) await this.putInCase(id, aCase, ffx, packWhen);
    for (const id of [bBody, bMvf, bHandle, bPlate, bCable, batteries[2]!, batteries[3]!, bTx]) await this.putInCase(id, bCase, ffx, packWhen);
    for (const id of Object.values(lenses)) await this.putInCase(id, lensCase, ffx, packWhen);
    for (const id of [rx1, rx2, mon1, mon2, mon3, bnc]) await this.putInCase(id, videoCase, ffx, packWhen);

    // Shooting started — A and B bodies plus lenses in use.
    const shootWhen = at("2026-09-07T06:30:00Z");
    for (const id of [aBody, bBody, ...Object.values(lenses)]) await this.setStatus(id, ffx, "on_project", "in_use", shootWhen);

    // A battery went missing on a location day; the user (not AI) marked it missing.
    const missingWhen = at("2026-09-19T19:10:00Z");
    await this.setStatus(batteries[5]!, ffx, "on_project", "missing", missingWhen, this.users.jonas);
    await this.createIssue({
      type: "missing",
      severity: "high",
      title: "bebob B290cine SN B290-31131 not found at wrap",
      description: "Last seen on the battery cart at the harbour location (day 10). Checked all sets and both camera carts.",
      projectId: ffx,
      itemId: batteries[5]!,
      when: missingWhen,
      actor: this.users.jonas,
    });

    // Condition note on the 50mm.
    const dmgWhen = at("2026-09-12T13:40:00Z");
    await this.tx.update(s.equipmentItem).set({ condition: "damaged", notes: "Light scratch on front element, outside image area." }).where(eq(s.equipmentItem.id, lenses.sp50!));
    await this.ev({
      action: "equipment_item.condition_changed",
      entityType: "equipment_item",
      entityId: lenses.sp50!,
      equipmentItemId: lenses.sp50!,
      projectId: ffx,
      caseId: lensCase,
      summary: "Signature Prime 50mm: minor wear → damaged",
      changes: { condition: { from: "minor_wear", to: "damaged" } },
      occurredAt: dmgWhen,
    });
    await this.createIssue({
      type: "damaged",
      severity: "medium",
      title: "Scratch on front element — Signature Prime 50mm",
      description: "Noticed during lens cleaning. Reported to ARRI Rental, no replacement needed yet.",
      projectId: ffx,
      itemId: lenses.sp50!,
      caseId: lensCase,
      when: dmgWhen,
    });

    // Partial return to MBF: one monitor and 6 of 12 BNC cables (bulk split).
    const retCorr = randomUUID();
    const mbfRet = await this.createDocument({ kind: "return_note", projectId: ffx, rhKey: "mbf", documentNumber: "MBF-R-78002", documentDate: "2026-09-28" });
    const retWhen = at("2026-09-28T16:00:00Z");
    await this.addLine(mbfRet, { description: "SmallHD Cine 7", quantity: 1, serialNumber: "C7-220880", typeKey: "cine7", itemId: mon3, resolution: "match_existing", matchConfidence: 1 });
    await this.addLine(mbfRet, { description: "BNC 3G-SDI 1m", quantity: 6, typeKey: "bnc", itemId: bnc, resolution: "match_existing", matchConfidence: 0.85, matchReason: "type match, 6 of 12 on project" });
    await this.returnItem({ itemId: mon3, projectId: ffx, documentId: mbfRet, when: retWhen, correlationId: retCorr, caseId: videoCase });

    // Bulk split: keep 6 on project, record the returned 6 as their own item.
    await this.tx.update(s.equipmentItem).set({ quantity: 6 }).where(eq(s.equipmentItem.id, bnc));
    await this.tx
      .update(s.projectAssignment)
      .set({ quantity: 6 })
      .where(and(eq(s.projectAssignment.equipmentItemId, bnc), isNull(s.projectAssignment.endedAt)));
    // After the partial return the video case is expected to hold 2 monitors and 6 BNCs.
    for (const [typeKey, from, to] of [["cine7", 3, 2], ["bnc", 12, 6]] as const) {
      await this.tx
        .update(s.caseExpectedItem)
        .set({ quantity: to })
        .where(and(eq(s.caseExpectedItem.caseId, videoCase), eq(s.caseExpectedItem.equipmentTypeId, this.types[typeKey]!.id)));
      await this.ev({
        action: "case.expected_contents_changed",
        entityType: "case",
        entityId: videoCase,
        caseId: videoCase,
        projectId: ffx,
        documentId: mbfRet,
        actor: this.users.mira,
        summary: `Video Village: expected ${this.types[typeKey]!.name} ${from} → ${to} after partial return`,
        changes: { [`expected.${typeKey}`]: { from, to } },
        occurredAt: retWhen,
        correlationId: retCorr,
      });
    }
    const [split] = await this.tx
      .insert(s.equipmentItem)
      .values({
        workspaceId: this.ws,
        equipmentTypeId: this.types.bnc!.id,
        trackingMode: "bulk",
        quantity: 6,
        rentalHouseId: this.rh.mbf!,
        status: "returned",
        condition: "ok",
        splitFromItemId: bnc,
      })
      .returning();
    await this.tx.insert(s.projectAssignment).values({
      workspaceId: this.ws,
      equipmentItemId: split!.id,
      projectId: ffx,
      rentalHouseId: this.rh.mbf!,
      quantity: 6,
      deliveryDocumentId: mbfDel,
      returnDocumentId: mbfRet,
      assignedAt: mbfWhen,
      assignedById: this.users.mira,
      endedAt: retWhen,
      endedById: this.users.mira,
      endReason: "returned",
    });
    this.names.set(split!.id, "BNC Cable 1 m × 6");
    await this.ev({
      action: "equipment_item.split",
      entityType: "equipment_item",
      entityId: bnc,
      equipmentItemId: bnc,
      projectId: ffx,
      documentId: mbfRet,
      actor: this.users.mira,
      summary: "BNC Cable 1 m: 6 of 12 split off for return",
      changes: { quantity: { from: 12, to: 6 } },
      metadata: { splitItemId: split!.id },
      occurredAt: retWhen,
      correlationId: retCorr,
    });
    await this.ev({
      action: "equipment_item.returned",
      entityType: "equipment_item",
      entityId: split!.id,
      equipmentItemId: split!.id,
      projectId: ffx,
      documentId: mbfRet,
      actor: this.users.mira,
      summary: "BNC Cable 1 m × 6 returned to rental house",
      changes: { status: { from: "on_project", to: "returned" } },
      metadata: { splitFromItemId: bnc },
      occurredAt: retWhen,
      correlationId: retCorr,
    });
    await this.ev({
      action: "return_note.imported",
      entityType: "document",
      entityId: mbfRet,
      documentId: mbfRet,
      projectId: ffx,
      actor: this.users.mira,
      summary: "Return MBF-R-78002 confirmed: partial return (2 lines); MBF equipment remains on project",
      occurredAt: retWhen,
      correlationId: retCorr,
    });

    // A resolved serial conflict from the MBF delivery.
    await this.createIssue({
      type: "serial_conflict",
      severity: "low",
      title: "Delivery note lists TX serial TD6-TX-40118 twice",
      description: "Line 1 of MBF-D-77310 printed the same serial for both transmitters.",
      projectId: ffx,
      documentId: mbfDel,
      itemId: bTx,
      when: at("2026-08-26T14:05:00Z"),
      actor: this.users.mira,
      resolved: { at: at("2026-08-26T17:20:00Z"), resolution: "Checked physical labels: the transmitters are TD6-TX-40112 and TD6-TX-40118. Corrected at check-in.", by: this.users.mira },
    });

    // A new ARRI delivery waiting for review (extracted, not yet confirmed).
    const pending = await this.createDocument({ kind: "delivery_note", projectId: ffx, rhKey: "arri", documentNumber: "LS-240512", documentDate: "2026-10-03", status: "extracted" });
    await this.addLine(pending, { description: "Angenieux Optimo 24-290", quantity: 1, serialNumber: "OPT-290-1123", typeKey: "optimo", resolution: "create_new", matchConfidence: 0.88, matchReason: "similar name: Angénieux Optimo 24-290 (new serial)" });
    await this.addLine(pending, { description: "cforce mini", quantity: 2, typeKey: "cforce", resolution: "create_new", matchConfidence: 0.95, matchReason: "catalog match: ARRI cforce mini" });
    await this.addLine(pending, { description: "Arri Alexa 35 Body", quantity: 1, serialNumber: "35-10577", typeKey: "alexa35", itemId: bBody, resolution: "discrepancy", matchConfidence: 1, matchReason: "ARRI ALEXA 35 (SN 35-10577) is already on this project (delivered twice?)" });

    void charger;
    void wcu;

    // ---- Upcoming project: no rentals yet; crew-owned timecode box ------------
    const mv = await this.createProject(
      "musicvideo",
      { name: "Music Video — Night Drive", code: "MVND", status: "planning", startDate: "2026-11-20", endDate: "2026-11-21" },
      at("2026-10-01T10:00:00Z"),
    );
    void mv;
    const [owned] = await this.tx
      .insert(s.equipmentItem)
      .values({
        workspaceId: this.ws,
        equipmentTypeId: this.types.tentacle!.id,
        serialNumber: "TS-E-009914",
        status: "available",
        condition: "ok",
        notes: "Crew-owned (Alex). Not rented.",
      })
      .returning();
    await this.ev({
      action: "equipment_item.created",
      entityType: "equipment_item",
      entityId: owned!.id,
      equipmentItemId: owned!.id,
      summary: "Tentacle Sync E (SN TS-E-009914) added as crew-owned equipment",
      occurredAt: at("2026-05-22T12:00:00Z"),
    });
  }
}
