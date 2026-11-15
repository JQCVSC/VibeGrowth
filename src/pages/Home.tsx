import { motion, useScroll, useTransform } from "motion/react";
import { 
  ArrowUpRight, 
  Users, 
  BarChart3, 
  Zap,
  ChevronRight
} from "lucide-react";
import { Link } from "react-router-dom";
import { useAudit } from "../context/AuditContext";

const Hero = () => {
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], [0, 200]);
  const { openAuditModal } = useAudit();

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center pt-32 pb-20 overflow-hidden px-6">
      {/* Background Elements */}
      <div className="absolute top-1/4 -left-20 w-96 h-96 bg-brand-primary/20 blur-[120px] rounded-full" />
      <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-brand-accent/20 blur-[120px] rounded-full" />
      
      <div className="max-w-7xl mx-auto text-center relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="inline-flex items-center gap-2 glass px-4 py-2 rounded-full mb-8"
        >
          <span className="w-2 h-2 bg-brand-primary rounded-full animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">VIBEGROWTH • Pinal County’s Local Growth Partner</span>
        </motion.div>

        <motion.h1 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="text-6xl md:text-[100px] font-display font-bold leading-[0.9] tracking-tighter mb-8"
        >
          <span className="text-brand-primary italic">IMPOSSIBLE TO IGNORE</span>
        </motion.h1>

        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="max-w-3xl mx-auto text-lg md:text-xl text-white/60 mb-12"
        >
          Are your neighbors calling the 'other guy' just because they can’t find you on Google? We put your business at the top of the map so you get the calls, not your competitors. Stop missing out on local jobs that should be yours.
        </motion.p>

        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="flex flex-col md:flex-row items-center justify-center gap-6"
        >
          <button 
            onClick={openAuditModal}
            className="group relative bg-brand-primary text-white px-10 py-5 rounded-full text-sm font-bold uppercase tracking-widest overflow-hidden transition-all hover:scale-105 active:scale-95"
          >
            <span className="relative z-10 flex items-center gap-2">
              Claim Your Local Market <ArrowUpRight className="w-4 h-4 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
            </span>
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
          </button>
        </motion.div>
      </div>
    </section>
  );
};

const Marquee = () => {
  const logos = ["SAN TAN VALLEY", "QUEEN CREEK", "FLORENCE", "COOLIDGE", "JOHNSON RANCH", "ENCANTERRA", "IRONWOOD CROSSING"];
  
  return (
    <div className="py-10 border-y border-white/10 overflow-hidden bg-brand-secondary">
      <div className="marquee-track">
        {[...logos, ...logos].map((logo, i) => (
          <span key={i} className="text-4xl md:text-5xl font-display font-black mx-12 text-white/10 hover:text-brand-primary transition-colors cursor-default tracking-tighter">
            {logo}
          </span>
        ))}
      </div>
    </div>
  );
};

const ServicesPreview = () => {
  const services = [
    {
      icon: <BarChart3 className="w-8 h-8" />,
      title: "Google Maps Dominance",
      desc: "We claim and optimize your Google Business Profile so you show up in the 'Top 3' when neighbors search for your services."
    },
    {
      icon: <Zap className="w-8 h-8" />,
      title: "Instant Lead Landing Pages",
      desc: "We build high-converting, mobile-friendly websites designed for one thing: getting the customer to click 'Call Now'."
    }
  ];

  return (
    <section id="services" className="py-32 px-6 bg-brand-secondary">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-end mb-20 gap-8">
          <div className="max-w-2xl">
            <h2 className="text-sm font-bold uppercase tracking-[0.3em] text-brand-primary mb-4">Why Choose Us</h2>
            <h3 className="text-5xl md:text-7xl font-display font-bold tracking-tighter leading-none">
              LOCAL STRATEGIES <br />
              <span className="text-stroke">THAT WIN NEIGHBORS</span>
            </h3>
          </div>
          <Link to="/services" className="text-brand-primary font-bold uppercase tracking-widest flex items-center gap-2 hover:gap-4 transition-all">
            View All Services <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-white/10 border border-white/10 max-w-5xl mx-auto">
          {services.map((s, i) => (
            <motion.div 
              key={i}
              whileHover={{ backgroundColor: "rgba(255, 92, 0, 0.05)" }}
              className="bg-brand-secondary p-12 transition-colors group cursor-pointer"
            >
              <div className="text-brand-primary mb-8 group-hover:scale-110 transition-transform duration-500">
                {s.icon}
              </div>
              <h4 className="text-2xl font-display font-bold mb-4">{s.title}</h4>
              <p className="text-white/40 leading-relaxed mb-8">{s.desc}</p>
              <Link to="/services" className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/20 group-hover:text-brand-primary transition-colors">
                Learn More <ChevronRight className="w-3 h-3" />
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

const WorkPreview = () => {
  const projects = [
    {
      title: "Lumina Skincare",
      category: "Full Management",
      image: "https://picsum.photos/seed/skincare/800/1000",
    },
    {
      title: "Apex Fitness",
      category: "Content & Ads",
      image: "https://picsum.photos/seed/fitness/800/1000",
    }
  ];

  return (
    <section id="work" className="py-32 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-24">
          <h2 className="text-sm font-bold uppercase tracking-[0.3em] text-brand-primary mb-4">Selected Work</h2>
          <h3 className="text-5xl md:text-8xl font-display font-bold tracking-tighter">CASE STUDIES</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          {projects.map((p, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: i * 0.1 }}
              className="group cursor-pointer"
            >
              <div className="relative aspect-[4/5] overflow-hidden rounded-3xl mb-6">
                <img 
                  src={p.image} 
                  alt={p.title} 
                  className="w-full h-full object-cover grayscale group-hover:grayscale-0 group-hover:scale-110 transition-all duration-700"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-brand-primary/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="absolute top-6 right-6 w-12 h-12 bg-white rounded-full flex items-center justify-center text-black opacity-0 group-hover:opacity-100 translate-y-4 group-hover:translate-y-0 transition-all duration-500">
                  <ArrowUpRight className="w-6 h-6" />
                </div>
              </div>
              <div className="flex justify-between items-end">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-brand-primary mb-2">{p.category}</div>
                  <h4 className="text-3xl font-display font-bold">{p.title}</h4>
                </div>
                <div className="text-white/20 font-display text-4xl font-bold">0{i + 1}</div>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="mt-24 text-center">
          <Link to="/work" className="border border-white/20 px-12 py-5 rounded-full text-sm font-bold uppercase tracking-widest hover:bg-white hover:text-black transition-all duration-300">
            View All Projects
          </Link>
        </div>
      </div>
    </section>
  );
};

const Stats = () => {
  const stats = [
    { label: "Map Pack Rankings", value: "Top 3" },
    { label: "Review Automation", value: "Experts" },
    { label: "Lead Generation", value: "Hyper-Local" },
    { label: "Based in STV", value: "Proudly" }
  ];

  return (
    <section className="py-32 px-6 bg-brand-primary">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-12">
          {stats.map((s, i) => (
            <div key={i} className="text-center">
              <div className="text-4xl md:text-6xl font-display font-bold mb-2 tracking-tighter uppercase">{s.value}</div>
              <div className="text-xs font-bold uppercase tracking-widest text-white/60">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const CTA = () => {
  const { openAuditModal } = useAudit();
  return (
    <section id="contact" className="py-32 px-6 overflow-hidden relative">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-brand-primary/10 blur-[150px] rounded-full" />
      
      <div className="max-w-7xl mx-auto text-center relative z-10">
        <h2 className="text-6xl md:text-[100px] font-display font-bold leading-[0.8] tracking-tighter mb-12">
          READY TO <br />
          <span className="text-brand-primary italic">DOMINATE?</span>
        </h2>
        <p className="max-w-xl mx-auto text-xl text-white/50 mb-12">
          Stop losing local leads to the "big guys" on Google. We help San Tan Valley service pros get the phone ringing.
        </p>
        <button 
          onClick={openAuditModal}
          className="bg-white text-black px-12 py-6 rounded-full text-sm font-bold uppercase tracking-widest hover:scale-110 transition-transform duration-300"
        >
          Get a Free Visibility Audit
        </button>
      </div>
    </section>
  );
};

export const Home = () => {
  return (
    <div className="bg-brand-secondary">
      <Hero />
      <Marquee />
      <ServicesPreview />
      <Stats />
      <CTA />
    </div>
  );
};
