import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import Documentation from "./pages/Documentation.tsx";
import Compare from "./pages/Compare.tsx";
import PreRace from "./pages/PreRace.tsx";
import Championship from "./pages/Championship.tsx";
import GpPreview from "./pages/GpPreview.tsx";
import NotFound from "./pages/NotFound.tsx";

const InternalLiveDashboard = lazy(() => import("./pages/InternalLiveDashboard.tsx"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/docs" element={<Documentation />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/pre-race" element={<PreRace />} />
          <Route path="/campionato" element={<Championship />} />
          <Route
            path="/internal-pitwall-live-x7k2m9"
            element={
              <Suspense fallback={<div className="p-6">Caricamento dashboard…</div>}>
                <InternalLiveDashboard />
              </Suspense>
            }
          />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
