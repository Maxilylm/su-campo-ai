"use client";

import { useState, useEffect, useCallback } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter,
  SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  Beef, MapPin, MoreHorizontal, Pencil, Trash2, Plus, ChevronDown, ChevronRight,
} from "lucide-react";

// ─── Types ──────────────────────────────────

interface Cattle {
  id: string; section_id: string | null; category: string; breed: string | null;
  count: number; tag_range: string | null; ear_tag: string | null;
  health_status: string; weight_kg: number | null; vaccination_status: string;
  reproductive_status: string | null; origin: string; notes: string | null;
}

interface SectionWithCattle {
  id: string; name: string; size_hectares: number | null; capacity: number | null;
  color: string; water_status: string; pasture_status: string; notes: string | null;
  padron_id: string | null;
  padrones?: { id: string; padron_code: string; department_name: string } | null;
  cattle: Cattle[];
}

// ─── Constants ──────────────────────────────

const CATEGORIES = ["vaca", "toro", "novillo", "vaquillona", "ternero", "ternera", "caballo", "yegua", "oveja"];
const BREEDS = ["Angus", "Hereford", "Braford", "Brangus", "Holando", "Criolla", "Cruza", "Otra"];
const SECTION_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

// ─── Page Component ─────────────────────────

export default function HaciendaPage() {
  const { sections: baseSections, refreshSections } = useFarm();
  const [sections, setSections] = useState<SectionWithCattle[]>([]);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<"add-section" | "edit-section" | "add-cattle" | "edit-cattle">("add-section");
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Section form
  const [secName, setSecName] = useState("");
  const [secHa, setSecHa] = useState("");
  const [secCap, setSecCap] = useState("");
  const [secColor, setSecColor] = useState("#22c55e");
  const [secWater, setSecWater] = useState("bueno");
  const [secPasture, setSecPasture] = useState("bueno");
  const [secNotes, setSecNotes] = useState("");

  // Cattle form
  const [catSection, setCatSection] = useState("");
  const [catCategory, setCatCategory] = useState("vaca");
  const [catBreed, setCatBreed] = useState("");
  const [catCount, setCatCount] = useState("1");
  const [catWeight, setCatWeight] = useState("");
  const [catEarTag, setCatEarTag] = useState("");
  const [catOrigin, setCatOrigin] = useState("propio");
  const [catVaxStatus, setCatVaxStatus] = useState("pendiente");
  const [catRepro, setCatRepro] = useState("");
  const [catHealth, setCatHealth] = useState("healthy");
  const [catNotes, setCatNotes] = useState("");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const ROWS_PER_PAGE = 20;

  const loadSectionsWithCattle = useCallback(async () => {
    try {
      const res = await fetch("/api/sections");
      if (res.ok) setSections(await res.json());
    } catch (e) {
      console.error("Load sections error:", e);
    }
  }, []);

  useEffect(() => { loadSectionsWithCattle(); }, [loadSectionsWithCattle]);

  async function onRefresh() {
    await loadSectionsWithCattle();
    await refreshSections();
  }

  function resetSectionForm() {
    setSecName(""); setSecHa(""); setSecCap(""); setSecColor("#22c55e");
    setSecWater("bueno"); setSecPasture("bueno"); setSecNotes(""); setEditId(null);
  }

  function resetCattleForm() {
    setCatSection(""); setCatCategory("vaca"); setCatBreed(""); setCatCount("1");
    setCatWeight(""); setCatEarTag(""); setCatOrigin("propio"); setCatVaxStatus("pendiente");
    setCatRepro(""); setCatHealth("healthy"); setCatNotes(""); setEditId(null);
  }

  function openAddSection() { resetSectionForm(); setSheetMode("add-section"); setSheetOpen(true); }
  function openEditSection(s: SectionWithCattle) {
    setSecName(s.name); setSecHa(s.size_hectares?.toString() || ""); setSecCap(s.capacity?.toString() || "");
    setSecColor(s.color); setSecWater(s.water_status); setSecPasture(s.pasture_status);
    setSecNotes(s.notes || ""); setEditId(s.id); setSheetMode("edit-section"); setSheetOpen(true);
  }
  function openAddCattle() { resetCattleForm(); setSheetMode("add-cattle"); setSheetOpen(true); }
  function openEditCattle(c: Cattle) {
    setCatSection(c.section_id || ""); setCatCategory(c.category); setCatBreed(c.breed || "");
    setCatCount(c.count.toString()); setCatWeight(c.weight_kg?.toString() || "");
    setCatEarTag(c.ear_tag || ""); setCatOrigin(c.origin || "propio");
    setCatVaxStatus(c.vaccination_status || "pendiente"); setCatRepro(c.reproductive_status || "");
    setCatHealth(c.health_status || "healthy"); setCatNotes(c.notes || "");
    setEditId(c.id); setSheetMode("edit-cattle"); setSheetOpen(true);
  }

  async function saveSection() {
    if (!secName.trim()) return;
    setSaving(true);
    const payload = { name: secName, sizeHectares: secHa ? Number(secHa) : null, capacity: secCap ? Number(secCap) : null, color: secColor, waterStatus: secWater, pastureStatus: secPasture, notes: secNotes || null };
    if (sheetMode === "edit-section" && editId) {
      await fetch("/api/sections", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editId, ...payload }) });
      toast.success("Seccion actualizada");
    } else {
      await fetch("/api/sections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      toast.success("Seccion creada");
    }
    setSheetOpen(false); setSaving(false); await onRefresh();
  }

  async function saveCattle() {
    if (!catSection) return;
    setSaving(true);
    const payload = { sectionId: catSection, category: catCategory, breed: catBreed || null, count: Number(catCount) || 1, weightKg: catWeight ? Number(catWeight) : null, earTag: catEarTag || null, origin: catOrigin, vaccinationStatus: catVaxStatus, reproductiveStatus: catRepro || null, healthStatus: catHealth, notes: catNotes || null };
    if (sheetMode === "edit-cattle" && editId) {
      await fetch("/api/cattle", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editId, ...payload }) });
      toast.success("Hacienda actualizada");
    } else {
      await fetch("/api/cattle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      toast.success("Hacienda registrada");
    }
    setSheetOpen(false); setSaving(false); await onRefresh();
  }

  async function deleteSection(id: string) {
    await fetch("/api/sections", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    toast.success("Seccion eliminada");
    await onRefresh();
  }

  async function deleteCattle(id: string) {
    await fetch("/api/cattle", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    toast.success("Hacienda eliminada");
    await onRefresh();
  }

  function toggleSection(id: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const isSecForm = sheetMode === "add-section" || sheetMode === "edit-section";
  const isCatForm = sheetMode === "add-cattle" || sheetMode === "edit-cattle";
  const isEditing = sheetMode.startsWith("edit");

  const allCattle = sections.flatMap((s) => s.cattle.map((c) => ({ ...c, sectionName: s.name, sectionColor: s.color })));
  const totalPages = Math.ceil(allCattle.length / ROWS_PER_PAGE);
  const paginatedCattle = allCattle.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);

  const vaxBadge = (status: string) => {
    if (status === "al_dia") return <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400 border-emerald-500/30">Al dia</Badge>;
    if (status === "vencida") return <Badge variant="outline" className="text-red-600 dark:text-red-400 border-red-500/30">Vencida</Badge>;
    return <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-500/30">Pendiente</Badge>;
  };

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[{ label: "Produccion", href: "/produccion/hacienda" }, { label: "Hacienda" }]}
        title="Hacienda"
        description="Gestiona secciones, potreros y registro de hacienda"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={openAddSection}><Plus className="h-4 w-4 mr-1.5" />Seccion</Button>
            <Button onClick={openAddCattle} disabled={sections.length === 0}><Plus className="h-4 w-4 mr-1.5" />Hacienda</Button>
          </div>
        }
      />

      {/* Sections — collapsible */}
      <div>
        <h2 className="text-lg font-medium mb-4">Secciones</h2>
        {sections.length === 0 ? (
          <EmptyState icon={MapPin} title="Sin secciones" description="Agrega tu primera seccion para empezar." actionLabel="Agregar seccion" onAction={openAddSection} />
        ) : (
          <div className="space-y-2">
            {sections.map((s) => {
              const expanded = expandedSections.has(s.id);
              const headCount = s.cattle.reduce((sum, c) => sum + c.count, 0);
              return (
                <div key={s.id} className="rounded-xl border border-border bg-card overflow-hidden">
                  <button onClick={() => toggleSection(s.id)} className="w-full flex items-center gap-3 p-4 hover:bg-accent/50 transition-colors text-left">
                    {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="font-medium flex-1">{s.name}</span>
                    <span className="text-sm font-semibold tabular-nums text-primary">{headCount} cab.</span>
                    <div className="flex gap-1.5 ml-2">
                      {s.size_hectares && <Badge variant="secondary">{s.size_hectares} ha</Badge>}
                      <Badge variant="outline">{s.water_status}</Badge>
                      <Badge variant="outline">{s.pasture_status}</Badge>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEditSection(s); }}><Pencil className="mr-2 h-4 w-4" />Editar</DropdownMenuItem>
                        <ConfirmDialog trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" />Eliminar</DropdownMenuItem>} title="Eliminar seccion" description={`Esto eliminara la seccion "${s.name}" y toda la hacienda asociada. Esta accion no se puede deshacer.`} onConfirm={() => deleteSection(s.id)} />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </button>
                  {expanded && s.cattle.length > 0 && (
                    <div className="border-t border-border px-4 py-3 bg-muted/30">
                      <div className="text-xs text-muted-foreground mb-2">{s.cattle.length} registros en esta seccion</div>
                      {s.cattle.map((c) => (
                        <div key={c.id} className="flex items-center justify-between py-1.5 text-sm">
                          <span>{c.count} {c.category}{c.breed ? ` (${c.breed})` : ""}</span>
                          <div className="flex items-center gap-2">
                            {vaxBadge(c.vaccination_status)}
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditCattle(c)}><Pencil className="h-3 w-3" /></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cattle table */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">Hacienda</h2>
          <span className="text-xs text-muted-foreground">{allCattle.length} registros</span>
        </div>
        {allCattle.length === 0 ? (
          <EmptyState icon={Beef} title="Sin hacienda" description="Registra tu primera hacienda para empezar el seguimiento." actionLabel="Registrar hacienda" onAction={openAddCattle} />
        ) : (
          <>
            <div className="rounded-xl border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Seccion</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Raza</TableHead>
                    <TableHead className="text-right">Cant.</TableHead>
                    <TableHead className="text-right">Peso</TableHead>
                    <TableHead>Caravana</TableHead>
                    <TableHead>Vacunas</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedCattle.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.sectionColor }} />
                          {c.sectionName}
                        </span>
                      </TableCell>
                      <TableCell className="capitalize">{c.category}</TableCell>
                      <TableCell className="text-muted-foreground">{c.breed || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{c.count}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{c.weight_kg ? `${c.weight_kg} kg` : "—"}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{c.ear_tag || c.tag_range || "—"}</TableCell>
                      <TableCell>{vaxBadge(c.vaccination_status)}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditCattle(c)}><Pencil className="mr-2 h-4 w-4" />Editar</DropdownMenuItem>
                            <ConfirmDialog trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" />Eliminar</DropdownMenuItem>} title="Eliminar hacienda" description="Esta accion no se puede deshacer." onConfirm={() => deleteCattle(c.id)} />
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
                <span>Pagina {currentPage} de {totalPages}</span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)}>Anterior</Button>
                  <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => p + 1)}>Siguiente</Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Sheet for forms */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto">
          {isSecForm && (
            <>
              <SheetHeader>
                <SheetTitle>{isEditing ? "Editar seccion" : "Nueva seccion"}</SheetTitle>
                <SheetDescription>Agrega o modifica un potrero en tu campo.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 py-6">
                <div className="space-y-2"><Label>Nombre</Label><Input value={secName} onChange={(e) => setSecName(e.target.value)} placeholder="Ej: Norte" /></div>
                <div className="space-y-2"><Label>Hectareas</Label><Input type="number" value={secHa} onChange={(e) => setSecHa(e.target.value)} placeholder="100" /></div>
                <div className="space-y-2"><Label>Capacidad (cabezas)</Label><Input type="number" value={secCap} onChange={(e) => setSecCap(e.target.value)} placeholder="500" /></div>
                <div className="space-y-2">
                  <Label>Color</Label>
                  <div className="flex gap-1.5">
                    {SECTION_COLORS.map((c) => (
                      <button key={c} onClick={() => setSecColor(c)} className={`w-7 h-7 rounded-full border-2 transition-all ${secColor === c ? "border-foreground scale-110" : "border-border"}`} style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Agua</Label>
                  <Select value={secWater} onValueChange={setSecWater}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bueno">Bueno</SelectItem>
                      <SelectItem value="bajo">Bajo</SelectItem>
                      <SelectItem value="seco">Seco</SelectItem>
                      <SelectItem value="inundado">Inundado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Pasto</Label>
                  <Select value={secPasture} onValueChange={setSecPasture}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bueno">Bueno</SelectItem>
                      <SelectItem value="sobrepastoreado">Sobrepastoreado</SelectItem>
                      <SelectItem value="seco">Seco</SelectItem>
                      <SelectItem value="creciendo">Creciendo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Notas</Label><Input value={secNotes} onChange={(e) => setSecNotes(e.target.value)} placeholder="Observaciones..." /></div>
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancelar</Button>
                <Button onClick={saveSection} disabled={!secName.trim() || saving}>{saving ? "Guardando..." : isEditing ? "Guardar cambios" : "Crear seccion"}</Button>
              </SheetFooter>
            </>
          )}
          {isCatForm && (
            <>
              <SheetHeader>
                <SheetTitle>{isEditing ? "Editar hacienda" : "Nueva hacienda"}</SheetTitle>
                <SheetDescription>Registra o modifica un lote de hacienda.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 py-6">
                <div className="space-y-2">
                  <Label>Seccion</Label>
                  <Select value={catSection} onValueChange={setCatSection}>
                    <SelectTrigger><SelectValue placeholder="Elegir seccion..." /></SelectTrigger>
                    <SelectContent>{sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Categoria</Label>
                  <Select value={catCategory} onValueChange={setCatCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Raza</Label>
                  <Select value={catBreed} onValueChange={setCatBreed}>
                    <SelectTrigger><SelectValue placeholder="Elegir raza..." /></SelectTrigger>
                    <SelectContent>{BREEDS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Cantidad</Label><Input type="number" value={catCount} onChange={(e) => setCatCount(e.target.value)} placeholder="1" /></div>
                <div className="space-y-2"><Label>Peso promedio (kg)</Label><Input type="number" value={catWeight} onChange={(e) => setCatWeight(e.target.value)} placeholder="350" /></div>
                <div className="space-y-2"><Label>Caravana</Label><Input value={catEarTag} onChange={(e) => setCatEarTag(e.target.value)} placeholder="001-050" /></div>
                <div className="space-y-2">
                  <Label>Origen</Label>
                  <Select value={catOrigin} onValueChange={setCatOrigin}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="propio">Propio</SelectItem>
                      <SelectItem value="comprado">Comprado</SelectItem>
                      <SelectItem value="transferido">Transferido</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Estado vacunacion</Label>
                  <Select value={catVaxStatus} onValueChange={setCatVaxStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="al_dia">Al dia</SelectItem>
                      <SelectItem value="pendiente">Pendiente</SelectItem>
                      <SelectItem value="vencida">Vencida</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Estado reproductivo</Label>
                  <Select value={catRepro} onValueChange={setCatRepro}>
                    <SelectTrigger><SelectValue placeholder="N/A" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">N/A</SelectItem>
                      <SelectItem value="prenada">Prenada</SelectItem>
                      <SelectItem value="lactando">Lactando</SelectItem>
                      <SelectItem value="servicio">En servicio</SelectItem>
                      <SelectItem value="vacia">Vacia</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Estado sanitario</Label>
                  <Select value={catHealth} onValueChange={setCatHealth}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="healthy">Sano</SelectItem>
                      <SelectItem value="enfermo">Enfermo</SelectItem>
                      <SelectItem value="tratamiento">En tratamiento</SelectItem>
                      <SelectItem value="cuarentena">Cuarentena</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Notas</Label><Input value={catNotes} onChange={(e) => setCatNotes(e.target.value)} placeholder="Observaciones..." /></div>
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancelar</Button>
                <Button onClick={saveCattle} disabled={!catSection || saving}>{saving ? "Guardando..." : isEditing ? "Guardar cambios" : "Registrar"}</Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
