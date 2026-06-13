-- ============================================================
-- Migration 032 — Force-seed missing role permission rows
-- ============================================================
-- Run this if migration 031 left some roles without rows in
-- role_permissions (associate, associate_partner, partner,
-- team_leader, cluster, cluster_head, digital_marketing, hr_admin).
-- Uses ON CONFLICT DO UPDATE so it is safe to re-run at any time.
-- ============================================================

INSERT INTO role_permissions (role, display_name, permissions) VALUES

('admin', 'Admin', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":true},
  "leads":          {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "projects":       {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "site_visits":    {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "revisits":       {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "closures":       {"view":true, "create":true, "edit":true, "delete":true, "approve":true, "export":true},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "attendance":     {"view":true, "create":true, "edit":true, "delete":true, "approve":true, "export":true},
  "salary":         {"view":true, "create":true, "edit":true, "delete":true, "approve":true, "export":true},
  "team":           {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "users":          {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "phone_requests": {"view":true, "create":false,"edit":true, "delete":false,"approve":true, "export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('sales_manager', 'Sales Manager', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":true},
  "leads":          {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true},
  "projects":       {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "site_visits":    {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true},
  "revisits":       {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true},
  "closures":       {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true},
  "attendance":     {"view":true, "create":false,"edit":false,"delete":false,"approve":true, "export":true},
  "salary":         {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "team":           {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "phone_requests": {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('sales_executive', 'Sales Executive', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "leads":          {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "projects":       {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "site_visits":    {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "revisits":       {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "closures":       {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "attendance":     {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "salary":         {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "team":           {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "phone_requests": {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('external_caller', 'External Caller', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "leads":          {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "projects":       {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "site_visits":    {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "revisits":       {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "closures":       {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "attendance":     {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "salary":         {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "team":           {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "phone_requests": {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('associate', 'Associate', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "leads":          {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "projects":       {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "site_visits":    {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "revisits":       {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "closures":       {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "attendance":     {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "salary":         {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "team":           {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "phone_requests": {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('associate_partner', 'Associate Partner', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":true},
  "leads":          {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true},
  "projects":       {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "site_visits":    {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true},
  "revisits":       {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true},
  "closures":       {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":true},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "attendance":     {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "salary":         {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "team":           {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "phone_requests": {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('partner', 'Partner', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":true},
  "leads":          {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "projects":       {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "site_visits":    {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "revisits":       {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "closures":       {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":false},
  "attendance":     {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "salary":         {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "team":           {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "phone_requests": {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('team_leader', 'Team Leader', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":true},
  "leads":          {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "projects":       {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "site_visits":    {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "revisits":       {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "closures":       {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":false},
  "attendance":     {"view":true, "create":true, "edit":true, "delete":false,"approve":true, "export":true},
  "salary":         {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "team":           {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "phone_requests": {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('cluster', 'Cluster', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":true},
  "leads":          {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "projects":       {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "site_visits":    {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "revisits":       {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "closures":       {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":false},
  "attendance":     {"view":true, "create":true, "edit":true, "delete":false,"approve":true, "export":true},
  "salary":         {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "team":           {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "phone_requests": {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('cluster_head', 'Cluster Head', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":true},
  "leads":          {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "projects":       {"view":true, "create":false,"edit":true, "delete":false,"approve":false,"export":true},
  "site_visits":    {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "revisits":       {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":true},
  "closures":       {"view":true, "create":true, "edit":true, "delete":true, "approve":true, "export":true},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":false},
  "attendance":     {"view":true, "create":true, "edit":true, "delete":false,"approve":true, "export":true},
  "salary":         {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "team":           {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "phone_requests": {"view":true, "create":true, "edit":true, "delete":false,"approve":true, "export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('digital_marketing', 'Digital Marketing', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":true},
  "leads":          {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":true},
  "projects":       {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "site_visits":    {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "revisits":       {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "closures":       {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "attendance":     {"view":true, "create":true, "edit":false,"delete":false,"approve":false,"export":false},
  "salary":         {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "team":           {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "phone_requests": {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}'),

('hr_admin', 'HR Admin', '{
  "dashboard":      {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":true},
  "leads":          {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "projects":       {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "site_visits":    {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "revisits":       {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "closures":       {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "follow_ups":     {"view":true, "create":true, "edit":true, "delete":true, "approve":false,"export":false},
  "attendance":     {"view":true, "create":true, "edit":true, "delete":true, "approve":true, "export":true},
  "salary":         {"view":true, "create":true, "edit":true, "delete":true, "approve":true, "export":true},
  "team":           {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "users":          {"view":true, "create":true, "edit":true, "delete":false,"approve":false,"export":false},
  "phone_requests": {"view":false,"create":false,"edit":false,"delete":false,"approve":false,"export":false},
  "notifications":  {"view":true, "create":false,"edit":false,"delete":false,"approve":false,"export":false}
}')

ON CONFLICT (role) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  permissions  = EXCLUDED.permissions,
  updated_at   = NOW();
