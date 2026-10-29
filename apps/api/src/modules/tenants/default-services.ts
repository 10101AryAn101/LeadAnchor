import type { Trade } from "@leadanchor/contracts";

/** Starter service catalogue per trade (C-17). Owners edit it later; the intake form uses it from day one. */
export const DEFAULT_SERVICES: Record<Trade, string[]> = {
  plumbing: ["Leak repair", "Drain cleaning", "Water heater repair or replacement", "Toilet repair", "Fixture installation", "Sewer line", "Emergency service"],
  electrical: ["Outlet or switch repair", "Lighting installation", "Panel upgrade", "EV charger installation", "Ceiling fan installation", "Troubleshooting"],
  hvac: ["AC repair", "Furnace repair", "Maintenance tune-up", "New system quote", "Thermostat installation", "Duct cleaning"],
  roofing: ["Roof leak repair", "Roof inspection", "Shingle replacement", "Gutter repair", "Storm damage"],
  handyman: ["General repairs", "Drywall repair", "Painting", "Door or window repair", "Furniture assembly"],
  landscaping: ["Lawn care", "Tree trimming", "Irrigation repair", "Yard cleanup"],
  salon: ["Haircut", "Color", "Blowout", "Styling"],
  grooming: ["Full groom", "Bath and brush", "Nail trim"],
  spa: ["Massage", "Facial", "Body treatment"],
  auto: ["Oil change", "Brakes", "Diagnostics", "Tires"],
  other: ["General service", "Quote request"],
};
