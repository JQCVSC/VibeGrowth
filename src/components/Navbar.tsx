import { motion } from "motion/react";
import { Zap, Menu, X, LogIn, LogOut, User } from "lucide-react";
import { useState, useEffect } from "react";
import { Link, NavLink } from "react-router-dom";
import { auth } from "../firebase";
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User as FirebaseUser } from "firebase/auth";

export const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [user, setUser] = useState<FirebaseUser | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user') {
        return;
      }
      console.error("Login Error:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  const navLinks = [
    { name: "Services", path: "/services" },
    { name: "Pricing", path: "/payment" },
    { name: "Contact", path: "/contact" },
  ];

  return (
    <nav className="fixed top-0 left-0 w-full z-50 px-6 py-4">
      <div className="max-w-7xl mx-auto flex justify-between items-center glass rounded-full px-6 py-3">
        <Link to="/" className="flex items-center gap-2">
          <img 
            src="https://i.imgur.com/nI2CZ2l.png" 
            alt="VIBEGROWTH" 
            className="h-12 w-auto" 
            referrerPolicy="no-referrer" 
          />
          <span className="font-display font-bold text-xl tracking-tighter uppercase hidden sm:block">
            VIBE<span className="text-brand-primary italic">GROWTH</span>
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-8 text-sm font-medium uppercase tracking-widest">
          {navLinks.map((link) => (
            <NavLink 
              key={link.name} 
              to={link.path} 
              className={({ isActive }) => 
                `hover:text-brand-primary transition-colors ${isActive ? "text-brand-primary" : "text-white/70"}`
              }
            >
              {link.name}
            </NavLink>
          ))}
          
          {user ? (
            <div className="flex items-center gap-4 pl-4 border-l border-white/10">
              <div className="flex items-center gap-2">
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || ""} className="w-8 h-8 rounded-full border border-white/10" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-brand-primary/20 flex items-center justify-center">
                    <User className="w-4 h-4 text-brand-primary" />
                  </div>
                )}
              </div>
              <button 
                onClick={handleLogout}
                className="text-white/40 hover:text-brand-primary transition-colors"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button 
              onClick={handleLogin}
              className="flex items-center gap-2 bg-brand-primary text-white px-6 py-2 rounded-full hover:scale-105 transition-all"
            >
              <LogIn className="w-4 h-4" />
              Login
            </button>
          )}
        </div>

        <button className="md:hidden" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? <X /> : <Menu />}
        </button>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute top-20 left-6 right-6 glass rounded-3xl p-8 flex flex-col gap-6 md:hidden"
        >
          {navLinks.map((link) => (
            <Link 
              key={link.name} 
              to={link.path} 
              className="text-2xl font-display font-bold" 
              onClick={() => setIsOpen(false)}
            >
              {link.name}
            </Link>
          ))}
        </motion.div>
      )}
    </nav>
  );
};
