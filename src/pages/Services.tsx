import { motion } from "motion/react";
import { 
  BarChart3, 
  Users, 
  Zap,
  ArrowUpRight,
  ShieldCheck,
  Star
} from "lucide-react";
import { Link } from "react-router-dom";
import { useAudit } from "../context/AuditContext";

const services = [
  {
    icon: <Users className="w-12 h-12" />,
    title: "Established Local Presence",
    subtitle: "Look Like the Trusted Pro You Are.",
    desc: "You’ve done the work to build your business—now we make sure Google shows that to your neighbors. We provide a \"Profile Blueprint\" that ensures your business looks established and professional to everyone searching in Johnson Ranch and Encanterra.",
    features: [
      "Local Keyword Blueprint: The exact words to copy-paste into your profile so neighbors find you for the specific jobs you do.",
      "Category Optimization: We identify the professional categories that ensure you show up in the right local search results.",
      "Pro Share Assets: High-end \"Link Previews\" for text messages that prove you’re an established brand every time you share your website."
    ]
  },
  {
    icon: <Zap className="w-12 h-12" />,
    title: "Instant Lead Landing Pages",
    subtitle: "A Website That Actually Makes the Phone Ring.",
    desc: "Most websites are too confusing for a busy homeowner. We build a high-speed, one-page \"Lead Machine\" designed for one thing: getting the customer to hit \"Call Now.\" Built specifically for San Tan Valley residents searching on their phones.",
    features: [
      "Mobile-First Design (Carrd): The perfect layout for customers who need a pro right now.",
      "One-Tap Calling: We make it impossible to miss your \"Call Now\" and \"Get a Quote\" buttons.",
      "Pinal County Logic: Professional copywriting that mentions our local neighborhoods to build instant trust.",
      "Zero-Maintenance Hosting: We handle the technical side; you just handle the incoming calls."
    ]
  },
  {
    icon: <ShieldCheck className="w-12 h-12" />,
    title: "The Review Engine Kit",
    subtitle: "The Most Trusted Name in the Neighborhood.",
    desc: "Reviews are the new word-of-mouth. We provide the physical and digital tools to help you build an established reputation before you even leave the job site.",
    features: [
      "Custom QR Code Flyer: A professional PDF you can print or show on your phone for instant customer reviews.",
      "Direct Review Links: No more \"search for me on Google.\" We give you the direct link that opens the \"Write a Review\" box instantly.",
      "SMS & Email Scripts: Simple, \"non-pushy\" templates to ask customers for reviews via text.",
      "Trust Badges: High-quality 5-star graphics to show off your established reputation on your new landing page."
    ]
  }
];

export const Services = () => {
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
            LOCAL <span className="text-brand-primary italic">GROWTH</span>
          </h1>
          <p className="max-w-2xl mx-auto text-xl text-white/50">
            We help San Tan Valley service pros dominate Google Maps and get the phone ringing.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {services.map((s, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="glass p-12 rounded-[40px] group hover:border-brand-primary transition-all duration-500 flex flex-col"
            >
              <div className="text-brand-primary mb-8 group-hover:scale-110 transition-transform duration-500">
                {s.icon}
              </div>
              <h2 className="text-3xl font-display font-bold mb-2">{s.title}</h2>
              <p className="text-brand-primary italic font-medium mb-6">"{s.subtitle}"</p>
              <p className="text-white/50 text-base leading-relaxed mb-8">{s.desc}</p>
              
              <div className="space-y-4 mb-12 flex-grow">
                {s.features.map((f, j) => (
                  <div key={j} className="flex items-start gap-3 text-xs font-bold uppercase tracking-widest text-white/30">
                    <div className="w-1.5 h-1.5 bg-brand-primary rounded-full shrink-0 mt-1" />
                    <span className="leading-tight">{f}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-4">
                <button 
                  onClick={openAuditModal}
                  className="inline-flex items-center justify-center gap-2 bg-white text-black px-8 py-4 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-brand-primary hover:text-white transition-all w-full"
                >
                  Establish Your Presence <ArrowUpRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="mt-40 glass p-12 md:p-24 rounded-[60px] text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full bg-brand-primary/5 blur-[100px]" />
          <div className="relative z-10">
            <h2 className="text-4xl md:text-6xl font-display font-bold mb-8">READY TO BE THE #1 CHOICE?</h2>
            <p className="max-w-xl mx-auto text-xl text-white/50 mb-12">
              Our strategists can help you build a custom lead generation engine tailored to your specific trade and territory.
            </p>
            <button 
              onClick={openAuditModal}
              className="bg-brand-primary text-white px-12 py-6 rounded-full text-sm font-bold uppercase tracking-widest hover:scale-110 transition-transform"
            >
              Get a Visibility Audit...Yes It’s Free !!
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
