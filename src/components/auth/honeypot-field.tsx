import { HONEYPOT_FIELD } from "@/lib/honeypot";

/** Champ piège : hors écran, ignoré au clavier et par les lecteurs d'écran ; seuls les robots le remplissent. */
export function HoneypotField() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
      <label>
        Ne pas remplir
        <input name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </label>
    </div>
  );
}
