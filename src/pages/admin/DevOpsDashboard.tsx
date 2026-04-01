import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HealthCards } from "@/components/admin/HealthCards";
import { DataStats } from "@/components/admin/DataStats";
import { ActiveJobs } from "@/components/admin/ActiveJobs";
import { ErrorLog } from "@/components/admin/ErrorLog";
import { ManualTriggers } from "@/components/admin/ManualTriggers";
import { WorkspaceInspector } from "@/components/admin/WorkspaceInspector";
import { QuotaMonitor } from "@/components/admin/QuotaMonitor";
import { Shield, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUserRole } from "@/hooks/useUserRole";

export default function DevOpsDashboard() {
  const { isAdmin, loading } = useUserRole();
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground">Checking permissions...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-6 px-4 max-w-7xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">DevOps Dashboard</h1>
              <p className="text-sm text-muted-foreground">System monitoring & manual controls</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh All
          </Button>
        </div>

        {/* Health Cards */}
        <HealthCards key={`health-${refreshKey}`} />

        {/* Data Stats */}
        <DataStats key={`stats-${refreshKey}`} />

        {/* Tabbed sections */}
        <Tabs defaultValue="triggers" className="mt-6">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="triggers">Manual Triggers</TabsTrigger>
            <TabsTrigger value="jobs">Active Jobs</TabsTrigger>
            <TabsTrigger value="errors">Error Log</TabsTrigger>
            <TabsTrigger value="inspector">Workspace Inspector</TabsTrigger>
            <TabsTrigger value="quotas">API Quotas</TabsTrigger>
          </TabsList>

          <TabsContent value="triggers" className="mt-4">
            <ManualTriggers key={`triggers-${refreshKey}`} />
          </TabsContent>

          <TabsContent value="jobs" className="mt-4">
            <ActiveJobs key={`jobs-${refreshKey}`} />
          </TabsContent>

          <TabsContent value="errors" className="mt-4">
            <ErrorLog key={`errors-${refreshKey}`} />
          </TabsContent>

          <TabsContent value="inspector" className="mt-4">
            <WorkspaceInspector key={`inspector-${refreshKey}`} />
          </TabsContent>

          <TabsContent value="quotas" className="mt-4">
            <QuotaMonitor key={`quotas-${refreshKey}`} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
