import { useEffect, useState } from "react";
import { Coffee } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "bmc-popup-dismissed";
const BMC_URL = "https://buymeacoffee.com/fabriziomonaco";

export function BuyMeCoffeePopup() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") return;
    } catch {
      // ignore
    }
    const t = window.setTimeout(() => setOpen(true), 4000);
    return () => window.clearTimeout(t);
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setOpen(false);
  };

  const handleSupport = () => {
    window.open(BMC_URL, "_blank", "noopener,noreferrer");
    dismiss();
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) dismiss();
          else setOpen(true);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <Coffee className="h-5 w-5 text-primary" />
              <DialogTitle>Supporta PitWall</DialogTitle>
            </div>
            <DialogDescription>
              PitWall è un progetto indipendente sviluppato da Fabrizio Monaco. Se ti è
              utile, offrigli un caffè per sostenere lo sviluppo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={dismiss}>
              Magari più tardi
            </Button>
            <Button onClick={handleSupport}>
              <Coffee className="mr-2 h-4 w-4" />
              Buy me a coffee
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <a
        href={BMC_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Buy me a coffee"
        className="fixed bottom-4 right-4 z-50 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg transition-transform hover:scale-105 hover:shadow-xl"
      >
        <Coffee className="h-4 w-4" />
        <span className="hidden sm:inline">Buy me a coffee</span>
      </a>
    </>
  );
}
