import type { Driver } from "@/lib/openf1";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  drivers: Driver[];
  selected: number[];
  onAdd: (driverNumber: number) => void;
  onRemove: (driverNumber: number) => void;
  max?: number;
}

export function DriverPicker({ drivers, selected, onAdd, onRemove, max = 3 }: Props) {
  const available = drivers.filter((d) => !selected.includes(d.driver_number));

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Drivers <span className="normal-case text-muted-foreground/60">({selected.length}/{max})</span>
      </label>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((num) => {
            const d = drivers.find((dr) => dr.driver_number === num);
            if (!d) return null;
            return (
              <span
                key={num}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium border border-border bg-muted"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: `#${d.team_colour || "ffffff"}` }}
                />
                <span className="font-mono font-bold">{d.name_acronym}</span>
                <button
                  onClick={() => onRemove(num)}
                  className="ml-0.5 rounded-sm hover:bg-foreground/10 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Add driver dropdown */}
      {selected.length < max && available.length > 0 && (
        <Select value="" onValueChange={(v) => onAdd(Number(v))}>
          <SelectTrigger className={cn("bg-muted border-border", selected.length > 0 ? "max-w-[200px]" : "max-w-xs")}>
            <SelectValue placeholder={selected.length === 0 ? "Select a driver" : "Add driver…"} />
          </SelectTrigger>
          <SelectContent>
            {available.map((d) => (
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
      )}
    </div>
  );
}
