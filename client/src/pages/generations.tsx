import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import type { ProjectImage } from "@shared/schema";
import {
  ArrowLeft,
  ImageIcon,
  Download,
  Calendar,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const appleFont = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';
const PER_PAGE = 24;

type ImageWithProject = ProjectImage & { projectTitle: string };

type GenerationsPageData = {
  items: ImageWithProject[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

function buildPageItems(current: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((p) => pages.add(p));
  const sorted = Array.from(pages).filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const items: Array<number | "…"> = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) items.push("…");
    items.push(sorted[i]);
  }
  return items;
}

function pluralImages(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "изображение";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "изображения";
  return "изображений";
}

export default function GenerationsPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedImage, setSelectedImage] = useState<ImageWithProject | null>(null);
  const [page, setPage] = useState(1);

  const { data, isLoading, isFetching } = useQuery<GenerationsPageData>({
    queryKey: ["/api/generations", page, PER_PAGE],
    queryFn: async () => {
      const res = await fetch(`/api/generations?page=${page}&limit=${PER_PAGE}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Не удалось загрузить генерации");
      return res.json();
    },
    enabled: !!user,
    placeholderData: (prev) => prev,
  });

  // Jump to top of grid when flipping pages
  useMemo(() => {
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    return null;
  }, [page]);

  const images = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const currentPage = data?.page ?? page;
  const pageItems = useMemo(() => buildPageItems(currentPage, totalPages), [currentPage, totalPages]);
  const pageStart = total === 0 ? 0 : (currentPage - 1) * PER_PAGE + 1;
  const pageEnd = Math.min(currentPage * PER_PAGE, total);

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
              {total} {pluralImages(total)}
              {totalPages > 1 ? ` · стр. ${currentPage} из ${totalPages}` : ""}
            </p>
          </div>
        </div>

        {isLoading && images.length === 0 ? (
          <div className="flex items-center justify-center" style={{ minHeight: 300 }}>
            <div className="w-6 h-6 border-2 border-gray-300 border-t-purple-500 rounded-full animate-spin" />
          </div>
        ) : total === 0 ? (
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
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: isFetching ? 0.65 : 1 }}
              className="grid gap-4 pb-6"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}
            >
              {images.map((img, i) => (
                <motion.div
                  key={img.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 12) * 0.02 }}
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

            {totalPages > 1 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  padding: "8px 4px 40px",
                }}
              >
                <div style={{ fontSize: "0.8rem", color: "#86868B" }}>
                  {pageStart}–{pageEnd} из {total}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage <= 1 || isFetching}
                    aria-label="Предыдущая страница"
                    style={{
                      width: 34, height: 34, borderRadius: 10, border: "1px solid #E0E0E5", background: "#fff",
                      cursor: currentPage <= 1 ? "default" : "pointer", opacity: currentPage <= 1 ? 0.4 : 1,
                      display: "flex", alignItems: "center", justifyContent: "center", color: "#1D1D1F",
                    }}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  {pageItems.map((item, idx) =>
                    item === "…" ? (
                      <span key={`e-${idx}`} style={{ width: 28, textAlign: "center", color: "#AEAEB2", fontSize: "0.85rem" }}>…</span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setPage(item)}
                        disabled={isFetching}
                        style={{
                          minWidth: 34, height: 34, borderRadius: 10,
                          border: item === currentPage ? "none" : "1px solid #E0E0E5",
                          background: item === currentPage ? "#8B5CF6" : "#fff",
                          color: item === currentPage ? "#fff" : "#1D1D1F",
                          fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", padding: "0 0.45rem",
                        }}
                      >
                        {item}
                      </button>
                    )
                  )}
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages || isFetching}
                    aria-label="Следующая страница"
                    style={{
                      width: 34, height: 34, borderRadius: 10, border: "1px solid #E0E0E5", background: "#fff",
                      cursor: currentPage >= totalPages ? "default" : "pointer", opacity: currentPage >= totalPages ? 0.4 : 1,
                      display: "flex", alignItems: "center", justifyContent: "center", color: "#1D1D1F",
                    }}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
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
