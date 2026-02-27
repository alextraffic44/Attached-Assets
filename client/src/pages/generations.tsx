import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import type { ProjectImage } from "@shared/schema";
import {
  ArrowLeft,
  ImageIcon,
  Download,
  ExternalLink,
  Calendar,
  X,
} from "lucide-react";

const appleFont = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';

type ImageWithProject = ProjectImage & { projectTitle: string };

export default function GenerationsPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedImage, setSelectedImage] = useState<ImageWithProject | null>(null);

  const { data: images = [], isLoading } = useQuery<ImageWithProject[]>({
    queryKey: ["/api/generations"],
  });

  const formatDate = (date: string | Date) => {
    const d = new Date(date);
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  if (!user) return null;

  return (
    <div style={{ fontFamily: appleFont, minHeight: "100vh", background: "linear-gradient(180deg, #FAFAFA 0%, #F2F2F7 100%)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px" }}>
        <div className="flex items-center gap-4 pt-8 pb-6">
          <button
            data-testid="button-back-dashboard"
            onClick={() => setLocation("/dashboard")}
            className="flex items-center gap-2 transition-all hover:opacity-70"
            style={{ background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 100, padding: "0.5rem 1.2rem", fontSize: "0.85rem", fontWeight: 600, color: "#1D1D1F", cursor: "pointer" }}
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Назад</span>
          </button>
          <div>
            <h1 style={{ fontSize: "1.8rem", fontWeight: 800, color: "#1D1D1F", letterSpacing: "-0.03em" }}>Мои генерации</h1>
            <p style={{ fontSize: "0.85rem", color: "#86868B", marginTop: 2 }}>
              {images.length} {images.length === 1 ? "изображение" : images.length < 5 ? "изображения" : "изображений"}
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center" style={{ minHeight: 300 }}>
            <div className="w-6 h-6 border-2 border-gray-300 border-t-purple-500 rounded-full animate-spin" />
          </div>
        ) : images.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center text-center"
            style={{ minHeight: 400 }}
          >
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: "rgba(139,92,246,0.08)" }}>
              <ImageIcon className="w-8 h-8" style={{ color: "#8B5CF6" }} />
            </div>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 700, color: "#1D1D1F", marginBottom: 8 }}>Нет генераций</h3>
            <p style={{ fontSize: "0.9rem", color: "#86868B", maxWidth: 360 }}>
              Создайте изображение в редакторе проекта, и оно появится здесь
            </p>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid gap-4 pb-12"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}
          >
            {images.map((img, i) => (
              <motion.div
                key={img.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                data-testid={`card-generation-${img.id}`}
                onClick={() => setSelectedImage(img)}
                className="group relative rounded-2xl overflow-hidden cursor-pointer transition-all hover:shadow-lg"
                style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.06)", aspectRatio: "1" }}
              >
                <img
                  src={img.url}
                  alt={img.name}
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  style={{ position: "absolute", inset: 0 }}
                  loading="lazy"
                />
                <div
                  className="absolute inset-x-0 bottom-0 p-3 transition-opacity"
                  style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.7))" }}
                >
                  <p className="text-white text-sm font-semibold truncate">{img.name}</p>
                  <p className="text-white/60 text-xs truncate">{img.projectTitle}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {selectedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(20px)" }}
            onClick={() => setSelectedImage(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative max-w-4xl w-full max-h-[90vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-white text-lg font-bold">{selectedImage.name}</h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-white/50 text-sm flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {formatDate(selectedImage.createdAt)}
                    </span>
                    <span className="text-white/50 text-sm">
                      {selectedImage.projectTitle}
                    </span>
                  </div>
                  {selectedImage.prompt && (
                    <p className="text-white/40 text-xs mt-2 max-w-lg truncate">{selectedImage.prompt}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={selectedImage.url}
                    download={`${selectedImage.name}.jpg`}
                    data-testid="button-download-image"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-80"
                    style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.1)" }}
                    onClick={e => e.stopPropagation()}
                  >
                    <Download className="w-4 h-4" />
                    Скачать
                  </a>
                  <button
                    onClick={() => setSelectedImage(null)}
                    data-testid="button-close-preview"
                    className="flex items-center justify-center w-9 h-9 rounded-lg text-white transition-all hover:opacity-80"
                    style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer" }}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 flex items-center justify-center overflow-hidden rounded-2xl" style={{ background: "rgba(0,0,0,0.3)" }}>
                <img
                  src={selectedImage.url}
                  alt={selectedImage.name}
                  className="max-w-full max-h-[75vh] object-contain"
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
