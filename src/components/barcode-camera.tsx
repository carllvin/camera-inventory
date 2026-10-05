"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff } from "lucide-react";
import { buttonVariants } from "./ui";
import { cn } from "@/lib/format";

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => Detector;
  }
}

const FORMATS = ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "data_matrix", "upc_a"];

export function useBarcodeSupport() {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    setSupported("BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia);
  }, []);
  return supported;
}

/**
 * Camera barcode/QR reader using the browser's BarcodeDetector (Chrome/Android).
 * Calls onCode once per detected code; `continuous` keeps scanning for packing runs.
 */
export function BarcodeCamera({
  onCode,
  continuous = false,
  label = "Scan with camera",
  compact = false,
}: {
  onCode: (code: string) => void;
  continuous?: boolean;
  label?: string;
  compact?: boolean;
}) {
  const supported = useBarcodeSupport();
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;
    let last = { value: "", at: 0 };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (cancelled) return;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const detector = new window.BarcodeDetector!({ formats: FORMATS });
        const tick = async () => {
          if (cancelled) return;
          try {
            const value = (await detector.detect(video))[0]?.rawValue?.trim();
            // Ignore the same code for 2.5 s so one label is not packed twice.
            if (value && (value !== last.value || Date.now() - last.at > 2500)) {
              last = { value, at: Date.now() };
              navigator.vibrate?.(60);
              onCodeRef.current(value);
              if (!continuous) {
                setActive(false);
                return;
              }
            }
          } catch {
            /* frame not ready yet */
          }
          timer = window.setTimeout(tick, 250);
        };
        tick();
      } catch {
        setError("Camera not available. Check the camera permission, or type the code.");
        setActive(false);
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active, continuous]);

  if (supported === null) return null;
  if (!supported) {
    return compact ? null : (
      <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
        This browser cannot read barcodes from the camera. Type the code, or use a handheld scanner (it types into the field).
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {active ? (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} className={cn("w-full object-cover", compact ? "aspect-video" : "aspect-[3/4] sm:aspect-video")} muted playsInline />
          <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-white/70" aria-hidden />
          <button type="button" onClick={() => setActive(false)} className={`${buttonVariants.secondary} absolute right-3 bottom-3`}>
            <CameraOff className="size-4" /> Stop
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setActive(true);
          }}
          className={cn(buttonVariants.primary, "w-full", !compact && "py-3 text-base")}
        >
          <Camera className="size-5" /> {label}
        </button>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
