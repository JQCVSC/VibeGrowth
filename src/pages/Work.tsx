import { motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useAudit } from "../context/AuditContext";

const projects = [
  {
    title: "San Tan Landscaper",
    category: "Google Maps Dominance",
    image: "https://picsum.photos/seed/landscaping/800/1000",
    results: ["Top 3 Map Pack", "+15 New Leads/mo", "Page 1 Ranking"]
  },
  {
    title: "Queen Creek Roofer",
    category: "Review Automation",
    image: "https://picsum.photos/seed/roofing/800/1000",
    results: ["3.2 to 4.8 Stars", "50+ New Reviews", "Instant Trust"]
  },
  {
    title: "Local Handyman",
    category: "Lead Landing Page",
    image: "https://picsum.photos/seed/handyman/800/1000",
    results: ["22 Calls/mo", "Mobile Optimized", "High Conversion"]
  },
  {
    title: "STV Plumber",
    category: "Full Lead Gen",
    image: "https://picsum.photos/seed/plumbing/800/1000",
    results: ["+200% Bookings", "Local Domination", "Review Boost"]
  },
  {
    title: "Pinal Electrician",
    category: "Search Visibility",
    image: "https://picsum.photos/seed/electrician/800/1000",
    results: ["#1 for 'Electrician'", "Verified Leads", "Brand Authority"]
  },
  {
    title: "Johnson Ranch HVAC",
    category: "Reputation Management",
    image: "https://picsum.photos/seed/hvac/800/1000",
    results: ["5-Star Growth", "Customer Loyalty", "Automated Follow-up"]
  }
];

export const Work = () => {
  const { openAuditModal } = useAudit();

  return (
    <div className="pt-40 pb-20 px-6">
      <div className="max-w-7xl mx-auto">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-32"
        >
          <h1 className="text-6xl md:text-9xl font-display font-bold tracking-tighter mb-8">
            LOCAL <span className="text-stroke">RESULTS</span>
          </h1>
          <p className="max-w-2xl mx-auto text-xl text-white/50">
            Real results for San Tan Valley service pros who wanted to beat the guy down the street.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-20">
          {projects.map((p, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: i * 0.1 }}
              className="group cursor-pointer"
            >
              <div className="relative aspect-[4/5] overflow-hidden rounded-[40px] mb-8">
                <img 
                  src={p.image} 
                  alt={p.title} 
                  className="w-full h-full object-cover grayscale group-hover:grayscale-0 group-hover:scale-110 transition-all duration-700"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-brand-primary/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="absolute top-8 right-8 w-16 h-16 bg-white rounded-full flex items-center justify-center text-black opacity-0 group-hover:opacity-100 translate-y-4 group-hover:translate-y-0 transition-all duration-500">
                  <ArrowUpRight className="w-8 h-8" />
                </div>
              </div>
              
              <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.3em] text-brand-primary mb-3">{p.category}</div>
                  <h2 className="text-4xl md:text-5xl font-display font-bold mb-6">{p.title}</h2>
                  <div className="flex flex-wrap gap-3">
                    {p.results.map((r, j) => (
                      <span key={j} className="glass px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest text-white/60">
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-white/10 font-display text-8xl font-bold hidden lg:block">0{i + 1}</div>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="mt-40 text-center">
          <h3 className="text-3xl font-display font-bold mb-8">WANT TO BE OUR NEXT SUCCESS STORY?</h3>
          <button 
            onClick={openAuditModal}
            className="bg-brand-primary text-white px-12 py-6 rounded-full text-sm font-bold uppercase tracking-widest hover:scale-110 transition-transform"
          >
            Claim Your Market
          </button>
        </div>
      </div>
    </div>
  );
};
