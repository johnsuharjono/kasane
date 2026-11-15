DROP SCHEMA IF EXISTS workspace CASCADE;
DROP SCHEMA IF EXISTS billing CASCADE;
CREATE SCHEMA workspace;
CREATE SCHEMA billing;
CREATE TABLE workspace.organizations (
 id integer PRIMARY KEY, name text NOT NULL, plan text NOT NULL,
 created_at timestamptz NOT NULL
);
CREATE TABLE workspace.members (
 id bigint PRIMARY KEY, organization_id integer NOT NULL REFERENCES workspace.organizations(id),
 name text NOT NULL, email text NOT NULL UNIQUE, role text NOT NULL CHECK(role IN ('owner','admin','member'))
);
CREATE TABLE workspace.projects (
 id integer PRIMARY KEY, organization_id integer NOT NULL REFERENCES workspace.organizations(id),
 name text NOT NULL, status text NOT NULL, settings jsonb NOT NULL DEFAULT '{}',
 UNIQUE(organization_id,name)
);
CREATE TABLE workspace.deployments (
 id bigint PRIMARY KEY, project_id integer NOT NULL REFERENCES workspace.projects(id),
 actor_id bigint REFERENCES workspace.members(id), status text NOT NULL,
 region text NOT NULL, duration_ms integer, started_at timestamptz NOT NULL
);
CREATE TABLE billing.invoices (
 id uuid PRIMARY KEY, organization_id integer NOT NULL REFERENCES workspace.organizations(id),
 amount numeric(20,2) NOT NULL CHECK(amount>=0), status text NOT NULL, due_date date NOT NULL
);
CREATE INDEX members_org_idx ON workspace.members(organization_id);
CREATE INDEX projects_org_idx ON workspace.projects(organization_id);
CREATE INDEX projects_settings_gin ON workspace.projects USING gin(settings);
CREATE INDEX deployments_project_date_idx ON workspace.deployments(project_id,started_at DESC) INCLUDE(status);
CREATE INDEX deployments_actor_idx ON workspace.deployments(actor_id);
CREATE INDEX deployments_failed_idx ON workspace.deployments(started_at) WHERE status='failed';
CREATE INDEX invoices_org_status_idx ON billing.invoices(organization_id,status);
CREATE VIEW workspace.project_activity AS
SELECT p.id,p.name,o.name AS organization,count(d.id) AS deployments,
       round(avg(d.duration_ms),2) AS average_duration_ms
FROM workspace.projects p JOIN workspace.organizations o ON o.id=p.organization_id
LEFT JOIN workspace.deployments d ON d.project_id=p.id
GROUP BY p.id,o.name;
COMMENT ON TABLE workspace.deployments IS 'Synthetic deployment history for a second isolated Kasane connection.';
