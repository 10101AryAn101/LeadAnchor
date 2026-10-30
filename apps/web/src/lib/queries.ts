"use client";

import type {
  BookingSettingsResponse,
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
  OutboxEmail,
  PaymentSettings,
  PushDevicesResponse,
  QuoteDetail,
  RegistrationResponse,
  ServiceItem,
  SettingsResponse,
  SimCalendarEvent,
  TagsResponse,
  WaitlistItem,
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
  outbox: ["outbox"] as const,
  pushDevices: ["push-devices"] as const,
  tags: ["tags"] as const,
  quote: (id: string) => ["quote", id] as const,
  paymentSettings: ["payment-settings"] as const,
  bookingSettings: ["booking-settings"] as const,
  waitlist: ["waitlist"] as const,
  simCalendar: ["sim-calendar"] as const,
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

export const useTags = () => useQuery({ queryKey: keys.tags, queryFn: () => api<TagsResponse>("/tags") });

export const usePushDevices = () => useQuery({ queryKey: keys.pushDevices, queryFn: () => api<PushDevicesResponse>("/push/devices") });

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => api<SettingsResponse>("/settings") });

export const useQuote = (id: string) => useQuery({ queryKey: keys.quote(id), queryFn: () => api<QuoteDetail>(`/quotes/${id}`) });

export const usePaymentSettings = () => useQuery({ queryKey: keys.paymentSettings, queryFn: () => api<PaymentSettings>("/payments/settings") });

export const useBookingSettings = () => useQuery({ queryKey: keys.bookingSettings, queryFn: () => api<BookingSettingsResponse>("/booking/settings") });

export const useWaitlist = () =>
  useQuery({ queryKey: keys.waitlist, queryFn: async () => (await api<{ entries: WaitlistItem[] }>("/waitlist")).entries });

export const useSimCalendar = (enabled: boolean) =>
  useQuery({
    queryKey: keys.simCalendar,
    queryFn: async () => (await api<{ events: SimCalendarEvent[] }>("/dev/simulator/calendar")).events,
    enabled,
    retry: false,
  });

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

export const useOutbox = () =>
  useQuery({ queryKey: keys.outbox, queryFn: async () => (await api<{ emails: OutboxEmail[] }>("/dev/outbox")).emails });

export const useIntegrations = () =>
  useQuery({
    queryKey: keys.integrations,
    queryFn: async () => (await api<{ integrations: IntegrationStatus[] }>("/integrations")).integrations,
  });
