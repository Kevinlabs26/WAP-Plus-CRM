import { timeZoneOptions, validTimeZone } from "@/lib/timeZone";

export function TimeZoneSelect({ value, onChange, label, automatic }: {
  value?: string; onChange: (value: string) => void; label: string; automatic: string;
}) {
  const options = timeZoneOptions();
  const selected = validTimeZone(value) || "";
  return <label className="block text-2xs text-zinc-500">
    {label}
    <select value={selected} className="ui-control mt-1 w-full px-2.5 text-[13px]"
      onChange={event => { if (!event.target.value || validTimeZone(event.target.value)) onChange(event.target.value); }}>
      <option value="">{automatic}</option>
      {selected && !options.includes(selected) && <option value={selected}>{selected}</option>}
      {options.map(zone => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}
    </select>
  </label>;
}
