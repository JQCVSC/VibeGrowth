import { Zap, Instagram, Twitter, Linkedin, Youtube } from "lucide-react";
import { Link } from "react-router-dom";

export const Footer = () => {
  return (
    <footer className="py-20 px-6 border-t border-white/10">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-20">
          <div className="col-span-1 md:col-span-2">
            <Link to="/" className="flex items-center gap-2 mb-8">
              <img 
                src="https://i.imgur.com/nI2CZ2l.png" 
                alt="VIBEGROWTH" 
                className="h-12 w-auto" 
                referrerPolicy="no-referrer" 
              />
              <span className="font-display font-bold text-xl tracking-tighter uppercase">
                VIBE<span className="text-brand-primary italic">GROWTH</span>
              </span>
            </Link>
            <p className="text-white/40 max-w-sm leading-relaxed">
              Pinal County’s local growth partner. We help San Tan Valley service pros dominate Google Maps and get the phone ringing.
            </p>
          </div>
          
          <div>
            <h5 className="font-bold uppercase tracking-widest text-xs mb-8">Navigation</h5>
            <ul className="space-y-4 text-sm text-white/60">
              <li><Link to="/" className="hover:text-brand-primary transition-colors">Home</Link></li>
              <li><Link to="/services" className="hover:text-brand-primary transition-colors">Services</Link></li>
              <li><Link to="/contact" className="hover:text-brand-primary transition-colors">Contact</Link></li>
            </ul>
          </div>

          <div>
            <h5 className="font-bold uppercase tracking-widest text-xs mb-8">Social</h5>
            <div className="flex gap-4">
              <a href="#" className="w-10 h-10 rounded-full glass flex items-center justify-center hover:bg-brand-primary transition-colors">
                <Instagram className="w-4 h-4" />
              </a>
              <a href="#" className="w-10 h-10 rounded-full glass flex items-center justify-center hover:bg-brand-primary transition-colors">
                <Twitter className="w-4 h-4" />
              </a>
              <a href="#" className="w-10 h-10 rounded-full glass flex items-center justify-center hover:bg-brand-primary transition-colors">
                <Linkedin className="w-4 h-4" />
              </a>
              <a href="#" className="w-10 h-10 rounded-full glass flex items-center justify-center hover:bg-brand-primary transition-colors">
                <Youtube className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>

        <div className="flex flex-col md:flex-row justify-between items-center pt-10 border-t border-white/5 text-[10px] font-bold uppercase tracking-widest text-white/20">
          <div>© 2026 VIBEGROWTH AGENCY. ALL RIGHTS RESERVED.</div>
          <div className="flex gap-8 mt-4 md:mt-0">
            <Link to="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-white transition-colors">Terms of Service</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};
