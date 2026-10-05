"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff } from "lucide-react";
import { ActionForm, Field, SubmitButton, useFormState } from "@/components/forms";
import { buttonVariants } from "@/components/ui";
import { lookupCodeAction } from "./actions";

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => Detector;
  }
}

function NotFoundHelp() {
  const state = useFormState();
  const code = state?.details?.code as string | undefined;
  if (!code) return null;
  return (
    <p className="text-sm text-muted">
      <Link href={`/search?q=${encodeURIComponent(code)}`} className="text-accent hover:underline">
        Search for “{code}”
      </Link>{" "}
      or{" "}
      <Link href={`/equipment/new`} className="text-accent hover:underline">
        add it as new equipment
      </Link>
      .
    </p>
  );
}

/** Camera scanning via the browser's BarcodeDetector (Chrome/Android); manual entry everywhere. */
export function Scanner() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (cancelled) return;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const detector = new window.BarcodeDetector!({ formats: ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "data_matrix", "upc_a"] });
        const tick = async () => {
          if (cancelled) return;
          try {
            const codes = await detector.detect(video);
            const value = codes[0]?.rawValue?.trim();
            if (value) {
              const input = formRef.current?.querySelector<HTMLInputElement>('input[name="code"]');
              if (input) {
                input.value = value;
                navigator.vibrate?.(60);
                setActive(false);
                input.form?.requestSubmit();
                return;
              }
            }
          } catch {
            /* frame not ready */
          }
          timer = window.setTimeout(tick, 250);
        };
        tick();
      } catch {
        setError("Camera not available. Check the browser's camera permission, or type the code.");
        setActive(false);
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active]);

  return (
    <div className="space-y-5">
      {supported && (
        <div>
          {active ? (
            <div className="relative overflow-hidden rounded-xl bg-black">
              <video ref={videoRef} className="aspect-[3/4] w-full object-cover sm:aspect-video" muted playsInline />
              <div className="pointer-events-none absolute inset-10 rounded-xl border-2 border-white/70" aria-hidden />
              <button type="button" onClick={() => setActive(false)} className={`${buttonVariants.secondary} absolute right-3 bottom-3`}>
                <CameraOff className="size-4" /> Stop
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => { setError(null); setActive(true); }} className={`${buttonVariants.primary} w-full py-3 text-base`}>
              <Camera className="size-5" /> Scan QR / barcode with camera
            </button>
          )}
        </div>
      )}
      {supported === false && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
          This browser cannot read barcodes from the camera. Type the code, or use a handheld scanner (it types into the field).
        </p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      <div ref={formRef}>
        <ActionForm action={lookupCodeAction} className="space-y-3">
          <Field label="Code" name="code" placeholder="QR / barcode, serial or asset number" autoComplete="off" spellCheck={false} autoCapitalize="characters" enterKeyHint="search" />
          <SubmitButton pendingText="Looking up…">Find</SubmitButton>
          <NotFoundHelp />
        </ActionForm>
      </div>
    </div>
  );
}
