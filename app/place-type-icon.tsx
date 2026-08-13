import {
  Anchor,
  Beef,
  BookOpen,
  Building2,
  BusFront,
  CableCar,
  Clapperboard,
  Coffee,
  Drama,
  Footprints,
  Hotel,
  LandPlot,
  Landmark,
  Library,
  MapPin,
  Paintbrush,
  TreePine,
  Trees,
  Utensils,
  Video,
  Waves,
  type LucideIcon,
} from "lucide-react";
import {
  placeTypeIconKey,
  type PlaceTypeIconKey,
} from "@/lib/place-type-icon";
import type { PlaceTypeT } from "@/lib/types/schema";

const ICONS: Record<PlaceTypeIconKey, LucideIcon> = {
  "map-pin": MapPin,
  waves: Waves,
  trees: Trees,
  landmark: Landmark,
  footprints: Footprints,
  beef: Beef,
  "cable-car": CableCar,
  coffee: Coffee,
  utensils: Utensils,
  hotel: Hotel,
  building: Building2,
  clapperboard: Clapperboard,
  anchor: Anchor,
  paintbrush: Paintbrush,
  "land-plot": LandPlot,
  library: Library,
  "book-open": BookOpen,
  "bus-front": BusFront,
  "tree-pine": TreePine,
  drama: Drama,
  video: Video,
};

export function PlaceTypeIcon({ placeType }: { placeType: PlaceTypeT | undefined }) {
  const Icon = ICONS[placeTypeIconKey(placeType)];
  return <Icon aria-hidden="true" className="size-5" strokeWidth={1.8} />;
}
