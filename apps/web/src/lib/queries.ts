"use client";

import type {
  CallItem,
  ConsentEntry,
  CustomerDetail,
  CustomerListItem,
  DashboardRange,
  DashboardSummary,
  IntegrationStatus,
  LeadCard,
  LeadDetail,
  MeResponse,
  NotificationItem,
  RegistrationResponse,
  ServiceItem,
  SettingsResponse,
} from "@leadanchor/contracts";
import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "./api";

/** One place for cache keys, so live updates know exactly what to refresh. */
export const keys = {
  me: ["me"] as const,
  dashboard: (range: DashboardRange) => ["dashboard", range] as const,
  dashboardAll: ["dashboard"] as const,
  leads: ["leads"] as const,
  lead: (id: string) => ["lead", id] as const,
  calls: ["calls"] as const,
  customers: (search = "") => ["customers", search] as const,
  customersAll: ["customers"] as const,
  customer: (id: string) => ["customer", id] as const,
  customerAll: ["customer"] as const,
  notifications: ["notifications"] as const,
  settings: ["settings"] as const,
  services: ["services"] as const,
  registration: ["registration"] as const,
  consent: (phone?: string) => ["consent", phone ?? "all"] as const,
  integrations: ["integrations"] as const,
  simCall: (sessionId: string) => ["sim-call", sessionId] as const,
  simInbox: (phone: string) => ["sim-inbox", phone] as const,
};

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => api<MeResponse>("/me"),
    staleTime: 60_000,
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
  });
}

export const useDashboard = (range: DashboardRange) =>
  useQuery({ queryKey: keys.dashboard(range), queryFn: () => api<DashboardSummary>(`/dashboard?range=${range}`) });

export const useLeads = () =>
  useQuery({ queryKey: keys.leads, queryFn: async () => (await api<{ leads: LeadCard[] }>("/leads")).leads });

export const useLead = (id: string | null) =>
  useQuery({ queryKey: keys.lead(id ?? "none"), queryFn: () => api<LeadDetail>(`/leads/${id}`), enabled: Boolean(id) });

export const useCalls = () =>
  useQuery({ queryKey: keys.calls, queryFn: async () => (await api<{ calls: CallItem[] }>("/calls")).calls });

export const useCustomers = (search: string) =>
  useQuery({
    queryKey: keys.customers(search),
    queryFn: async () => (await api<{ customers: CustomerListItem[] }>(`/customers?q=${encodeURIComponent(search)}`)).customers,
    placeholderData: (previous) => previous,
  });

export const useCustomer = (id: string) => useQuery({ queryKey: keys.customer(id), queryFn: () => api<CustomerDetail>(`/customers/${id}`) });

export const useNotifications = () =>
  useQuery({
    queryKey: keys.notifications,
    queryFn: () => api<{ items: NotificationItem[]; unread: number }>("/notifications"),
  });

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => api<SettingsResponse>("/settings") });

export const useServices = () =>
  useQuery({ queryKey: keys.services, queryFn: async () => (await api<{ services: ServiceItem[] }>("/services")).services });

export const useRegistration = () =>
  useQuery({ queryKey: keys.registration, queryFn: () => api<RegistrationResponse>("/compliance/registration") });

export const useConsent = (phone?: string) =>
  useQuery({
    queryKey: keys.consent(phone),
    queryFn: () =>
      api<{ backend: "local" | "firestore"; entries: ConsentEntry[] }>(
        `/compliance/consent${phone ? `?phone=${encodeURIComponent(phone)}` : ""}`,
      ),
  });

export const useIntegrations = () =>
  useQuery({
    queryKey: keys.integrations,
    queryFn: async () => (await api<{ integrations: IntegrationStatus[] }>("/integrations")).integrations,
  });
