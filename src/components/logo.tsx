/** The app's mark: an iris on tally orange (same drawing as app/icon.svg). */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="7.5" fill="#d9480f"/><circle cx="16.0" cy="16.0" r="10.6" fill="#ffffff"/><polygon points="20.44,14.81 19.25,19.25 14.81,20.44 11.56,17.19 12.75,12.75 17.19,11.56" fill="#d9480f"/><g stroke="#d9480f" strokeWidth="1.5" strokeLinecap="round"><path d="M20.44 14.81L22.39 7.54"/><path d="M19.25 19.25L26.52 17.31"/><path d="M14.81 20.44L20.13 25.76"/><path d="M11.56 17.19L9.61 24.46"/><path d="M12.75 12.75L5.48 14.69"/><path d="M17.19 11.56L11.87 6.24"/></g>
    </svg>
  );
}
