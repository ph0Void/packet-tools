"use client";

import React, { useEffect, useState } from "react";
import { BookOpen, ChevronDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MANUAL_SECTIONS } from "./manual/sections";

export default function UserManual() {
  const [query, setQuery] = useState("");
  const [isIndexOpen, setIsIndexOpen] = useState(false);
  const [activeId, setActiveId] = useState<string>(MANUAL_SECTIONS[0]?.id ?? "");

  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? MANUAL_SECTIONS.filter((section) =>
        [section.title, section.description, ...section.keywords].some(
          (value) => value.toLowerCase().includes(normalized),
        ),
      )
    : MANUAL_SECTIONS;

  useEffect(() => {
    if (normalized) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) =>
              a.boundingClientRect.top - b.boundingClientRect.top,
          );
        if (visible[0]?.target.id) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-90px 0px -65% 0px", threshold: 0 },
    );
    for (const section of MANUAL_SECTIONS) {
      const node = document.getElementById(section.id);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [normalized]);

  const goTo = (id: string) => {
    setActiveId(id);
    setIsIndexOpen(false);
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm md:p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2.5 text-primary">
            <BookOpen className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold tracking-tight">
              Centro de Documentación
            </h2>
            <p className="text-xs text-muted-foreground">
              Guía paso a paso de todas las pestañas del sistema, con
              referencias rápidas para operadores de red.
            </p>
            <div className="relative mt-4 max-w-md">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar en el manual..."
                aria-label="Buscar en el manual"
                className="pl-9"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setIsIndexOpen((prev) => !prev)}
          aria-expanded={isIndexOpen}
          aria-controls="manual-index"
          className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-card p-4 text-left shadow-sm"
        >
          <span className="text-sm font-semibold">Índice del manual</span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform duration-200",
              isIndexOpen && "rotate-180",
            )}
          />
        </button>
        {isIndexOpen && (
          <nav
            id="manual-index"
            className="mt-2 space-y-1 rounded-xl border border-border bg-card p-2 shadow-sm"
          >
            {filtered.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => goTo(section.id)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                <section.icon className="h-4 w-4 shrink-0 text-primary" />
                {section.title}
              </button>
            ))}
          </nav>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav className="sticky top-6 space-y-1 rounded-xl border border-border bg-card p-2 shadow-sm">
            <p className="px-3 pt-2 pb-1 text-xs font-semibold uppercase text-muted-foreground">
              Secciones
            </p>
            {filtered.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => goTo(section.id)}
                aria-current={activeId === section.id ? "true" : undefined}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  activeId === section.id
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <section.icon className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0">{section.title}</span>
              </button>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 space-y-6">
          {filtered.length === 0 && (
            <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
              No se encontraron secciones para{" "}
              <span className="font-medium text-foreground">
                &quot;{query.trim()}&quot;
              </span>
              .
            </div>
          )}

          {filtered.map((section) => (
            <article
              key={section.id}
              id={section.id}
              className="scroll-mt-24 rounded-xl border border-border bg-card p-4 shadow-sm md:p-6"
            >
              <header className="mb-4 flex items-start gap-3 border-b border-border pb-4">
                <div className="rounded-lg bg-primary/10 p-2.5 text-primary">
                  <section.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold tracking-tight">
                    {section.title}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {section.description}
                  </p>
                </div>
              </header>
              <section.Component />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
