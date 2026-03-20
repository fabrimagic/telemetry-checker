import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search } from "lucide-react";

interface Props {
  onSubmit: (sessionKey: number) => void;
  isLoading: boolean;
}

export function SessionInput({ onSubmit, isLoading }: Props) {
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseInt(value, 10);
    if (!isNaN(num)) onSubmit(num);
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-3 items-end">
      <div className="flex-1 max-w-xs">
        <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
          Session Key
        </label>
        <Input
          placeholder="e.g. 9161"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="bg-muted border-border font-mono tabular-nums"
        />
      </div>
      <Button type="submit" disabled={!value.trim() || isLoading} className="gap-2">
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        Load Session
      </Button>
    </form>
  );
}
