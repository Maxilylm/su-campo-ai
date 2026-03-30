"use client";

import { useState, useEffect, useCallback } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { StatCard } from "@/components/StatCard";
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
import { toast } from "sonner";
import {
  Wheat, Plus, MoreHorizontal, Pencil, Trash2, Sprout, MapPin, BarChart3, Layers,
} from "lucide-react";

// ─── Types ──────────────────────────────────

interface Crop {
  id: string;
  section_id: string | null;
  crop_type: string;
  variety: string | null;
  planted_hectares: number | null;
  planting_date: string | null;
  expected_harvest: string | null;
  actual_harvest: string | null;
  yield_kg: number | null;
  yield_per_hectare: number | null;
  status: string;
  soil_type: string | null;
  irrigation_type: string | null;
  notes: string | null;
  sections?: { name: string } | null;
  crop_applications?: { id: string }[];
}

// ─── Constants ──────────────────────────────

const CROP_TYPES = ["soja", "trigo", "maiz", "girasol", "sorgo", "cebada", "arroz", "avena", "otro"];
const SOIL_TYPES = ["arcilloso", "arenoso", "limoso", "franco"];
const IRRIGATION_TYPES = ["secano", "pivot", "aspersion", "goteo"];
const APP_TYPES = ["fertilizante", "herbicida", "insecticida", "fungicida"];
const WEATHER_OPTIONS = ["soleado", "nublado", "lluvioso", "ventoso"];

const STATUS_LABELS: Record<string, string> = {
  planted: "Sembrado",
  growing: "Creciendo",
  harvested: "Cosechado",
  failed: "Fallido",
};

const STATUS_BADGE_CLASSES: Record<string, string> = {
  planted: "text-blue-600 dark:text-blue-400 border-blue-500/30",
  growing: "text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  harvested: "text-amber-600 dark:text-amber-400 border-amber-500/30",
  failed: "text-red-600 dark:text-red-400 border-red-500/30",
};

// ─── Page Component ─────────────────────────

export default function AgriculturaPage() {
  const { sections } = useFarm();
  const [crops, setCrops] = useState<Crop[]>([]);
  const [saving, setSaving] = useState(false);

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<"add-crop" | "edit-crop" | "add-app">("add-crop");
  const [editId, setEditId] = useState<string | null>(null);
  const [appCropId, setAppCropId] = useState<string | null>(null);

  // Crop form state
  const [cropSection, setCropSection] = useState("");
  const [cropType, setCropType] = useState("soja");
  const [cropVariety, setCropVariety] = useState("");
  const [cropHectares, setCropHectares] = useState("");
  const [cropPlantingDate, setCropPlantingDate] = useState("");
  const [cropExpectedHarvest, setCropExpectedHarvest] = useState("");
  const [cropActualHarvest, setCropActualHarvest] = useState("");
  const [cropYieldKg, setCropYieldKg] = useState("");
  const [cropStatus, setCropStatus] = useState("planted");
  const [cropSoilType, setCropSoilType] = useState("");
  const [cropIrrigationType, setCropIrrigationType] = useState("");
  const [cropNotes, setCropNotes] = useState("");

  // Application form state
  const [appType, setAppType] = useState("fertilizante");
  const [appProduct, setAppProduct] = useState("");
  const [appDose, setAppDose] = useState("");
  const [appTotal, setAppTotal] = useState("");
  const [appDate, setAppDate] = useState("");
  const [appAppliedBy, setAppAppliedBy] = useState("");
  const [appWeather, setAppWeather] = useState("");
  const [appNotes, setAppNotes] = useState("");

  const loadCrops = useCallback(async () => {
    try {
      const res = await fetch("/api/crops");
      if (res.ok) setCrops(await res.json());
    } catch (e) {
      console.error("Load crops error:", e);
    }
  }, []);

  useEffect(() => {
    loadCrops();
  }, [loadCrops]);

  function resetCropForm() {
    setCropSection(""); setCropType("soja"); setCropVariety(""); setCropHectares("");
    setCropPlantingDate(""); setCropExpectedHarvest(""); setCropActualHarvest("");
    setCropYieldKg(""); setCropStatus("planted"); setCropSoilType("");
    setCropIrrigationType(""); setCropNotes(""); setEditId(null);
  }

  function resetAppForm() {
    setAppType("fertilizante"); setAppProduct(""); setAppDose(""); setAppTotal("");
    setAppDate(""); setAppAppliedBy(""); setAppWeather(""); setAppNotes("");
    setAppCropId(null);
  }

  function openAddCrop() {
    resetCropForm();
    setSheetMode("add-crop");
    setSheetOpen(true);
  }

  function openEditCrop(c: Crop) {
    setCropSection(c.section_id || ""); setCropType(c.crop_type);
    setCropVariety(c.variety || ""); setCropHectares(c.planted_hectares?.toString() || "");
    setCropPlantingDate(c.planting_date || ""); setCropExpectedHarvest(c.expected_harvest || "");
    setCropActualHarvest(c.actual_harvest || ""); setCropYieldKg(c.yield_kg?.toString() || "");
    setCropStatus(c.status); setCropSoilType(c.soil_type || "");
    setCropIrrigationType(c.irrigation_type || ""); setCropNotes(c.notes || "");
    setEditId(c.id); setSheetMode("edit-crop"); setSheetOpen(true);
  }

  function openAddApp(cropId: string) {
    resetAppForm();
    setAppCropId(cropId);
    setSheetMode("add-app");
    setSheetOpen(true);
  }

  async function saveCrop() {
    setSaving(true);
    const payload = {
      sectionId: cropSection || null,
      cropType,
      variety: cropVariety || null,
      plantedHectares: cropHectares ? Number(cropHectares) : null,
      plantingDate: cropPlantingDate || null,
      expectedHarvest: cropExpectedHarvest || null,
      actualHarvest: cropActualHarvest || null,
      yieldKg: cropYieldKg ? Number(cropYieldKg) : null,
      status: cropStatus,
      soilType: cropSoilType || null,
      irrigationType: cropIrrigationType || null,
      notes: cropNotes || null,
    };
    if (sheetMode === "edit-crop" && editId) {
      await fetch("/api/crops", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editId, ...payload }),
      });
      toast.success("Cultivo actualizado");
    } else {
      await fetch("/api/crops", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      toast.success("Cultivo creado");
    }
    setSheetOpen(false); setSaving(false); await loadCrops();
  }

  async function deleteCrop(id: string) {
    await fetch("/api/crops", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    toast.success("Cultivo eliminado");
    await loadCrops();
  }

  async function saveApplication() {
    if (!appCropId) return;
    setSaving(true);
    await fetch("/api/crop-applications", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cropId: appCropId,
        type: appType,
        productName: appProduct || null,
        dosePerHectare: appDose || null,
        totalApplied: appTotal || null,
        dateApplied: appDate || null,
        appliedBy: appAppliedBy || null,
        weatherConditions: appWeather || null,
        notes: appNotes || null,
      }),
    });
    toast.success("Aplicacion registrada");
    setSheetOpen(false); setSaving(false); await loadCrops();
  }

  const isEditing = sheetMode === "edit-crop";
  const isCropForm = sheetMode === "add-crop" || sheetMode === "edit-crop";
  const isAppForm = sheetMode === "add-app";

  // Stats
  const totalHa = crops.reduce((sum, c) => sum + (c.planted_hectares || 0), 0);
  const activeCrops = crops.filter((c) => c.status === "planted" || c.status === "growing").length;
  const pendingHarvests = crops.filter((c) => c.expected_harvest && !c.actual_harvest && c.status !== "failed").length;

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[
          { label: "Produccion", href: "/produccion/hacienda" },
          { label: "Agricultura" },
        ]}
        title="Agricultura"
        description="Gestiona cultivos, siembras y aplicaciones"
        actions={
          <Button onClick={openAddCrop}>
            <Plus className="h-4 w-4 mr-1.5" />Nuevo cultivo
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Ha sembradas" value={totalHa} accent="emerald" icon={MapPin} />
        <StatCard label="Cultivos activos" value={activeCrops} accent="blue" icon={Sprout} />
        <StatCard label="Cosechas pendientes" value={pendingHarvests} accent="amber" icon={BarChart3} />
        <StatCard label="Total cultivos" value={crops.length} accent="purple" icon={Layers} />
      </div>

      {/* Crop cards */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">Cultivos</h2>
          <span className="text-xs text-muted-foreground">{crops.length} registros</span>
        </div>

        {crops.length === 0 ? (
          <EmptyState
            icon={Wheat}
            title="Sin cultivos"
            description="Agrega tu primer cultivo para empezar."
            actionLabel="Nuevo cultivo"
            onAction={openAddCrop}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {crops.map((c) => (
              <div key={c.id} className="rounded-xl border border-border bg-card p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate">
                      {c.crop_type.charAt(0).toUpperCase() + c.crop_type.slice(1)}
                    </span>
                    {c.variety && <span className="text-muted-foreground text-xs">({c.variety})</span>}
                    <Badge variant="outline" className={STATUS_BADGE_CLASSES[c.status] || ""}>
                      {STATUS_LABELS[c.status] || c.status}
                    </Badge>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditCrop(c)}>
                        <Pencil className="mr-2 h-4 w-4" />Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openAddApp(c.id)}>
                        <Sprout className="mr-2 h-4 w-4" />Agregar aplicacion
                      </DropdownMenuItem>
                      <ConfirmDialog
                        trigger={
                          <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                            <Trash2 className="mr-2 h-4 w-4" />Eliminar
                          </DropdownMenuItem>
                        }
                        title="Eliminar cultivo"
                        description={`Esto eliminara el cultivo "${c.crop_type}" y sus aplicaciones. Esta accion no se puede deshacer.`}
                        onConfirm={() => deleteCrop(c.id)}
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {c.sections?.name && (
                    <Badge variant="secondary">{c.sections.name}</Badge>
                  )}
                  {c.planted_hectares && (
                    <Badge variant="outline">{c.planted_hectares} ha</Badge>
                  )}
                  {c.planting_date && (
                    <Badge variant="outline">Siembra: {c.planting_date}</Badge>
                  )}
                  {c.expected_harvest && (
                    <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-500/30">
                      Cosecha: {c.expected_harvest}
                    </Badge>
                  )}
                  {c.actual_harvest && (
                    <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                      Cosechado: {c.actual_harvest}
                    </Badge>
                  )}
                  {c.yield_kg != null && (
                    <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                      {c.yield_kg} kg
                    </Badge>
                  )}
                  {c.yield_per_hectare != null && (
                    <Badge variant="outline">{c.yield_per_hectare} kg/ha</Badge>
                  )}
                  {c.soil_type && (
                    <Badge variant="outline">Suelo: {c.soil_type}</Badge>
                  )}
                  {c.irrigation_type && (
                    <Badge variant="outline" className="text-blue-600 dark:text-blue-400 border-blue-500/30">
                      Riego: {c.irrigation_type}
                    </Badge>
                  )}
                  {c.crop_applications && c.crop_applications.length > 0 && (
                    <Badge variant="outline" className="text-purple-600 dark:text-purple-400 border-purple-500/30">
                      {c.crop_applications.length} aplicaciones
                    </Badge>
                  )}
                </div>
                {c.notes && <p className="text-xs text-muted-foreground">{c.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sheet for forms */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto">
          {isCropForm && (
            <>
              <SheetHeader>
                <SheetTitle>{isEditing ? "Editar cultivo" : "Nuevo cultivo"}</SheetTitle>
                <SheetDescription>
                  {isEditing ? "Modifica los datos del cultivo." : "Agrega un nuevo cultivo a tu campo."}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 py-6">
                <div className="space-y-2">
                  <Label>Tipo de cultivo</Label>
                  <Select value={cropType} onValueChange={setCropType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CROP_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Variedad</Label>
                  <Input value={cropVariety} onChange={(e) => setCropVariety(e.target.value)} placeholder="Ej: DM 46i17" />
                </div>
                <div className="space-y-2">
                  <Label>Seccion</Label>
                  <Select value={cropSection} onValueChange={setCropSection}>
                    <SelectTrigger><SelectValue placeholder="Elegir seccion..." /></SelectTrigger>
                    <SelectContent>
                      {sections.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Hectareas</Label>
                  <Input type="number" value={cropHectares} onChange={(e) => setCropHectares(e.target.value)} placeholder="100" />
                </div>
                <div className="space-y-2">
                  <Label>Fecha de siembra</Label>
                  <Input type="date" value={cropPlantingDate} onChange={(e) => setCropPlantingDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Cosecha esperada</Label>
                  <Input type="date" value={cropExpectedHarvest} onChange={(e) => setCropExpectedHarvest(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Cosecha real</Label>
                  <Input type="date" value={cropActualHarvest} onChange={(e) => setCropActualHarvest(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Rendimiento (kg)</Label>
                  <Input type="number" value={cropYieldKg} onChange={(e) => setCropYieldKg(e.target.value)} placeholder="3500" />
                </div>
                <div className="space-y-2">
                  <Label>Estado</Label>
                  <Select value={cropStatus} onValueChange={setCropStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Tipo de suelo</Label>
                  <Select value={cropSoilType} onValueChange={setCropSoilType}>
                    <SelectTrigger><SelectValue placeholder="Elegir..." /></SelectTrigger>
                    <SelectContent>
                      {SOIL_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Riego</Label>
                  <Select value={cropIrrigationType} onValueChange={setCropIrrigationType}>
                    <SelectTrigger><SelectValue placeholder="Elegir..." /></SelectTrigger>
                    <SelectContent>
                      {IRRIGATION_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Notas</Label>
                  <Input value={cropNotes} onChange={(e) => setCropNotes(e.target.value)} placeholder="Observaciones..." />
                </div>
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancelar</Button>
                <Button onClick={saveCrop} disabled={saving}>
                  {saving ? "Guardando..." : isEditing ? "Guardar cambios" : "Crear cultivo"}
                </Button>
              </SheetFooter>
            </>
          )}
          {isAppForm && (
            <>
              <SheetHeader>
                <SheetTitle>Nueva aplicacion</SheetTitle>
                <SheetDescription>Registra una aplicacion de producto al cultivo.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 py-6">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select value={appType} onValueChange={setAppType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {APP_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Producto</Label>
                  <Input value={appProduct} onChange={(e) => setAppProduct(e.target.value)} placeholder="Ej: Glifosato" />
                </div>
                <div className="space-y-2">
                  <Label>Dosis por hectarea</Label>
                  <Input value={appDose} onChange={(e) => setAppDose(e.target.value)} placeholder="2 L/ha" />
                </div>
                <div className="space-y-2">
                  <Label>Total aplicado</Label>
                  <Input value={appTotal} onChange={(e) => setAppTotal(e.target.value)} placeholder="200 L" />
                </div>
                <div className="space-y-2">
                  <Label>Fecha</Label>
                  <Input type="date" value={appDate} onChange={(e) => setAppDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Aplicado por</Label>
                  <Input value={appAppliedBy} onChange={(e) => setAppAppliedBy(e.target.value)} placeholder="Nombre" />
                </div>
                <div className="space-y-2">
                  <Label>Clima</Label>
                  <Select value={appWeather} onValueChange={setAppWeather}>
                    <SelectTrigger><SelectValue placeholder="Elegir..." /></SelectTrigger>
                    <SelectContent>
                      {WEATHER_OPTIONS.map((w) => (
                        <SelectItem key={w} value={w}>{w.charAt(0).toUpperCase() + w.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Notas</Label>
                  <Input value={appNotes} onChange={(e) => setAppNotes(e.target.value)} placeholder="Observaciones..." />
                </div>
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancelar</Button>
                <Button onClick={saveApplication} disabled={saving}>
                  {saving ? "Guardando..." : "Registrar aplicacion"}
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
