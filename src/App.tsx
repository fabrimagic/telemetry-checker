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
import NotFound from "./pages/NotFound.tsx";
import TelemetryBackground from "./components/TelemetryBackground.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <TelemetryBackground />
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/docs" element={<Documentation />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/pre-race" element={<PreRace />} />
          <Route path="/campionato" element={<Championship />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
