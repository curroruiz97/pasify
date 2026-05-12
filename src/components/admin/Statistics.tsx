import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Users, QrCode, Calendar, TrendingUp, Search, ChevronRight } from "lucide-react";
import UserDetailChart from "./UserDetailChart";
import { useTranslation } from "react-i18next";
import { useStatistics } from "@/hooks/useStatistics";
import { MetricsCharts } from "./MetricsCharts";

const Statistics = () => {
  const { t } = useTranslation();
  const { data: stats, isLoading: loading } = useStatistics();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string; role: "partner" | "client" } | null>(null);
  const [activeSection, setActiveSection] = useState<"overview" | "partners" | "clients">("overview");

  const filteredPartners = (stats?.allPartners || []).filter(p =>
    (p.business_name || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredClients = (stats?.allClients || []).filter(c =>
    `${c.first_name} ${c.last_name}`.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatLastAccess = (date?: string) => {
    if (!date) return "Sin acceso";
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 60) return `Hace ${diffMins}m`;
    if (diffHours < 24) return `Hace ${diffHours}h`;
    if (diffDays < 7) return `Hace ${diffDays}d`;
    return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-muted-foreground">Cargando estadísticas...</div>
      </div>
    );
  }

  const qrPercentage = (stats?.totalQRCodes || 0) > 0
    ? Math.round(((stats?.usedQRCodes || 0) / (stats?.totalQRCodes || 1)) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Section Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {[
          { id: "overview", label: "Resumen" },
          { id: "partners", label: "Socios" },
          { id: "clients", label: "Estudiantes" },
        ].map((section) => (
          <button
            key={section.id}
            onClick={() => setActiveSection(section.id as any)}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
              activeSection === section.id
                ? "bg-primary text-primary-foreground shadow-lg"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            {section.label}
          </button>
        ))}
      </div>

      {/* Overview Section */}
      {activeSection === "overview" && (
        <div className="space-y-4">
          {/* Charts: trend + funnel + top eventi */}
          <MetricsCharts />

          {/* Stats Grid - 2x3 */}
          <div className="grid grid-cols-2 gap-3">
            {/* Total Users */}
            <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 rounded-2xl p-4 border border-blue-500/20">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                  <Users className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stats?.totalUsers || 0}</p>
                  <p className="text-xs text-muted-foreground">Usuarios</p>
                </div>
              </div>
            </div>

            {/* Partners */}
            <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 rounded-2xl p-4 border border-purple-500/20">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-purple-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stats?.totalPartners || 0}</p>
                  <p className="text-xs text-muted-foreground">Socios</p>
                </div>
              </div>
            </div>

            {/* Clients */}
            <div className="bg-gradient-to-br from-green-500/10 to-green-600/5 rounded-2xl p-4 border border-green-500/20">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-green-500/20 flex items-center justify-center">
                  <Users className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stats?.totalClients || 0}</p>
                  <p className="text-xs text-muted-foreground">Estudiantes</p>
                </div>
              </div>
            </div>

            {/* QR Codes */}
            <div className="bg-gradient-to-br from-orange-500/10 to-orange-600/5 rounded-2xl p-4 border border-orange-500/20">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
                  <QrCode className="h-5 w-5 text-orange-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stats?.totalQRCodes || 0}</p>
                  <p className="text-xs text-muted-foreground">QR Codes</p>
                </div>
              </div>
            </div>

            {/* QR Used */}
            <div className="bg-gradient-to-br from-pink-500/10 to-pink-600/5 rounded-2xl p-4 border border-pink-500/20">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-pink-500/20 flex items-center justify-center">
                  <QrCode className="h-5 w-5 text-pink-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stats?.usedQRCodes || 0}</p>
                  <p className="text-xs text-muted-foreground">QR Usados ({qrPercentage}%)</p>
                </div>
              </div>
            </div>

            {/* Accesses 7d */}
            <div className="bg-gradient-to-br from-cyan-500/10 to-cyan-600/5 rounded-2xl p-4 border border-cyan-500/20">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
                  <Calendar className="h-5 w-5 text-cyan-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stats?.recentAccesses || 0}</p>
                  <p className="text-xs text-muted-foreground">Accesos 7d</p>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Lists */}
          <div className="space-y-4">
            {/* Top Partners */}
            <div className="bg-muted/30 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-foreground">Top Socios</h3>
                <button 
                  onClick={() => setActiveSection("partners")}
                  className="text-xs text-primary font-medium"
                >
                  Ver todos
                </button>
              </div>
              <div className="space-y-2">
                {(stats?.allPartners || []).slice(0, 3).map((partner, idx) => (
                  <div key={partner.id} className="flex items-center gap-3 p-2 rounded-xl bg-background/50">
                    <span className="text-sm font-bold text-muted-foreground w-5">{idx + 1}</span>
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={partner.profile_image_url} />
                      <AvatarFallback className="text-xs bg-primary/10 text-primary">
                        {partner.business_name?.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{partner.business_name}</p>
                    </div>
                    <span className="text-xs font-semibold text-primary">{partner.qr_count} QR</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Clients */}
            <div className="bg-muted/30 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-foreground">Top Estudiantes</h3>
                <button 
                  onClick={() => setActiveSection("clients")}
                  className="text-xs text-primary font-medium"
                >
                  Ver todos
                </button>
              </div>
              <div className="space-y-2">
                {(stats?.allClients || []).slice(0, 3).map((client, idx) => (
                  <div key={client.id} className="flex items-center gap-3 p-2 rounded-xl bg-background/50">
                    <span className="text-sm font-bold text-muted-foreground w-5">{idx + 1}</span>
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={client.profile_image_url} />
                      <AvatarFallback className="text-xs bg-primary/10 text-primary">
                        {client.first_name?.charAt(0)}{client.last_name?.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{client.first_name} {client.last_name}</p>
                    </div>
                    <span className="text-xs font-semibold text-primary">{client.qr_count} QR</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Partners Section */}
      {activeSection === "partners" && (
        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar partners..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 rounded-xl bg-muted/50 border-0"
            />
          </div>

          {/* Partners List */}
          <div className="space-y-2">
            {filteredPartners.map((partner) => (
              <button
                key={partner.id}
                onClick={() => setSelectedUser({ 
                  id: partner.id, 
                  name: partner.business_name || "Partner", 
                  role: "partner" 
                })}
                className="w-full flex items-center gap-3 p-3 rounded-2xl bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <Avatar className="h-11 w-11 ring-2 ring-border/30">
                  <AvatarImage src={partner.profile_image_url} />
                  <AvatarFallback className="bg-primary/10 text-primary font-medium">
                    {partner.business_name?.substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left min-w-0">
                  <p className="font-medium text-foreground truncate">{partner.business_name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{partner.qr_count} QR</span>
                    <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
                    <span>{partner.used_count} usados</span>
                    <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
                    <span>{formatLastAccess(partner.last_access)}</span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
            ))}
            {filteredPartners.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No se encontraron partners</p>
            )}
          </div>
        </div>
      )}

      {/* Clients Section */}
      {activeSection === "clients" && (
        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar estudiantes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 rounded-xl bg-muted/50 border-0"
            />
          </div>

          {/* Clients List */}
          <div className="space-y-2">
            {filteredClients.map((client) => (
              <button
                key={client.id}
                onClick={() => setSelectedUser({ 
                  id: client.id, 
                  name: `${client.first_name} ${client.last_name}`, 
                  role: "client" 
                })}
                className="w-full flex items-center gap-3 p-3 rounded-2xl bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <Avatar className="h-11 w-11 ring-2 ring-border/30">
                  <AvatarImage src={client.profile_image_url} />
                  <AvatarFallback className="bg-primary/10 text-primary font-medium">
                    {client.first_name?.charAt(0)}{client.last_name?.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left min-w-0">
                  <p className="font-medium text-foreground truncate">{client.first_name} {client.last_name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{client.qr_count} QR descargados</span>
                    <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
                    <span>{formatLastAccess(client.last_access)}</span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
            ))}
            {filteredClients.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No se encontraron estudiantes</p>
            )}
          </div>
        </div>
      )}

      {selectedUser && (
        <UserDetailChart
          userId={selectedUser.id}
          userName={selectedUser.name}
          userRole={selectedUser.role}
          open={!!selectedUser}
          onOpenChange={(open) => !open && setSelectedUser(null)}
        />
      )}
    </div>
  );
};

export default Statistics;