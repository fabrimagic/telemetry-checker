import type { Driver } from "@/lib/openf1";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  drivers: Driver[];
  selected: number | null;
  onSelect: (driverNumber: number) => void;
}

export function DriverPicker({ drivers, selected, onSelect }: Props) {
  return (
    <div className="max-w-xs">
      <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
        Driver
      </label>
      <Select
        value={selected?.toString() ?? ""}
        onValueChange={(v) => onSelect(Number(v))}
      >
        <SelectTrigger className="bg-muted border-border">
          <SelectValue placeholder="Select a driver" />
        </SelectTrigger>
        <SelectContent>
          {drivers.map((d) => (
            <SelectItem key={d.driver_number} value={d.driver_number.toString()}>
              <span className="flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: `#${d.team_colour || "ffffff"}` }}
                />
                <span className="font-mono font-bold text-xs">{d.name_acronym}</span>
                <span className="text-muted-foreground text-xs">{d.full_name}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
