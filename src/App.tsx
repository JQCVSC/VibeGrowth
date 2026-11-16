import { BrowserRouter as Router, Routes, Route, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Navbar } from "./components/Navbar";
import { Footer } from "./components/Footer";
import { Home } from "./pages/Home";
import { Services } from "./pages/Services";
import { Work } from "./pages/Work";
import { Contact } from "./pages/Contact";
import { Payment } from "./pages/Payment";
import { PaymentSuccess } from "./pages/PaymentSuccess";
import { AdminAudits } from "./pages/AdminAudits";
import { Privacy } from "./pages/Privacy";
import { Terms } from "./pages/Terms";
import { AuditProvider } from "./context/AuditContext";
import { AuditModal } from "./components/AuditModal";

const ScrollToTop = () => {
  const { pathname } = useLocation();
  
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  
  return null;
};

export default function App() {
  return (
    <AuditProvider>
      <Router>
        <ScrollToTop />
        <div className="bg-brand-secondary text-white selection:bg-brand-primary selection:text-white min-h-screen flex flex-col">
          <Navbar />
          <main className="flex-grow">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/services" element={<Services />} />
              <Route path="/work" element={<Work />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/payment" element={<Payment />} />
              <Route path="/payment-success" element={<PaymentSuccess />} />
              <Route path="/admin/audits" element={<AdminAudits />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              {/* Fallback for other routes */}
              <Route path="*" element={<Home />} />
            </Routes>
          </main>
          <Footer />
          <AuditModal />
        </div>
      </Router>
    </AuditProvider>
  );
}
