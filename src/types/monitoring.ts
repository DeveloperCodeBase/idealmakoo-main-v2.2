export const monitoringViews = ['overview', 'availability', 'performance', 'business', 'content', 'security', 'jobs', 'notifications', 'ai', 'storage', 'infrastructure', 'recovery'] as const;
export const operationalRoutes = ['site', 'requests', 'workspace', 'crm', 'resources', 'media', 'ai', 'auth', 'account', 'other'] as const;
export const incidentStates = ['new', 'ack', 'investigating', 'resolved'] as const;
export const incidentServices = ['app', 'database', 'worker', 'notifications', 'ai', 'storage', 'tls', 'recovery', 'security', 'content'] as const;
export const publicMetricRoutes = ['home', 'products', 'product', 'research', 'article', 'news', 'events', 'event', 'resources', 'resource', 'contact', 'about', 'request-form'] as const;

export type MonitoringView = typeof monitoringViews[number];
export type OperationalRoute = typeof operationalRoutes[number];
export type IncidentState = typeof incidentStates[number];
export type IncidentService = typeof incidentServices[number];
export type ObservationState = 'unknown' | 'observed' | 'passing' | 'breaching' | 'stale' | 'disabled';

export interface MonitoringMetric {
  key: string;
  value: number | null;
  unit: string;
  samples: number;
  state: ObservationState;
  note?: string;
}
export interface MonitoringObservation {
  id: string;
  key: string;
  state: ObservationState;
  sampledAt: string | null;
  metrics: MonitoringMetric[];
  note?: string;
}
export interface MonitoringCapabilities {
  allowedViews: MonitoringView[];
  manageIncidents: boolean;
  manageSlos: boolean;
}
export interface MonitoringResponse {
  view: MonitoringView;
  sampledAt: string;
  window: { minutes: number; from: string; to: string };
  coverage: { source: string; samples: number; truncated: boolean };
  metrics: MonitoringMetric[];
  observations: MonitoringObservation[];
  capabilities: MonitoringCapabilities;
  release: { id: string; commitSha: string | null };
  openIncidents: number | null;
}
