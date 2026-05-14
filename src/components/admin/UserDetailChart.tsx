import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays, subMonths } from "date-fns";
import { es } from "date-fns/locale";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, BarChart, Bar, CartesianGrid } from "recharts";
import { QrCode, LogIn, Calendar } from "lucide-react";

interface UserDetailChartProps {
  userId: string;
  userName: string;
  userRole: "partner" | "client";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ChartData {
  date: string;
  shortDate: string;
  qr_codes: number;
  accesses: number;
  events?: number;
}

// Tooltip extraído del componente padre (antes era nested → cada render
// destruía la instancia, anti-pattern flageado por react-doctor).
// Recharts acepta function components vía la prop `content`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-background/95 backdrop-blur-sm border border-border rounded-lg p-3 shadow-xl">
        <p className="text-xs font-medium text-foreground mb-1">{label}</p>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {payload.map((entry: any) => (
          <p key={entry.dataKey ?? entry.name} className="text-xs" style={{ color: entry.color }}>
            {entry.name}: <span className="font-semibold">{entry.value}</span>
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const UserDetailChart = ({ userId, userName, userRole, open, onOpenChange }: UserDetailChartProps) => {
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d">("30d");
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState({ qr: 0, accesses: 0, events: 0 });

  useEffect(() => {
    if (open) {
      fetchChartData();
    }
  }, [open, timeRange, userId]);

  const getDateRange = () => {
    const now = new Date();
    switch (timeRange) {
      case "7d":
        return { start: subDays(now, 7), days: 7 };
      case "30d":
        return { start: subDays(now, 30), days: 30 };
      case "90d":
        return { start: subMonths(now, 3), days: 90 };
      default:
        return { start: subDays(now, 30), days: 30 };
    }
  };

  const fetchChartData = async () => {
    setLoading(true);
    try {
      const { start, days } = getDateRange();
      const end = new Date();
      
      // Fetch QR codes data
      let qrData: any[] = [];

      if (userRole === "client") {
        const { data } = await supabase
          .from("qr_codes")
          .select("created_at, is_used")
          .eq("client_id", userId)
          .gte("created_at", start.toISOString())
          .lte("created_at", end.toISOString());
        qrData = data || [];
      } else {
        // For partners, get QR codes from both events and discounts
        const { data: events } = await supabase
          .from("events")
          .select("id")
          .eq("partner_id", userId)
          .eq("type", "event");

        const eventIds = events?.map(e => e.id) || [];

        const { data: discounts } = await supabase
          .from("discounts")
          .select("id")
          .eq("partner_id", userId);

        const discountIds = discounts?.map(d => d.id) || [];

        // Get QR codes from events
        if (eventIds.length > 0) {
          const { data: eventQRs } = await supabase
            .from("qr_codes")
            .select("created_at, is_used")
            .in("event_id", eventIds)
            .gte("created_at", start.toISOString())
            .lte("created_at", end.toISOString());
          qrData = [...qrData, ...(eventQRs || [])];
        }

        // Get QR codes from discounts
        if (discountIds.length > 0) {
          const { data: discountQRs } = await supabase
            .from("qr_codes")
            .select("created_at, is_used")
            .in("discount_id", discountIds)
            .gte("created_at", start.toISOString())
            .lte("created_at", end.toISOString());
          qrData = [...qrData, ...(discountQRs || [])];
        }
      }

      // Fetch access logs
      const { data: accessData } = await supabase
        .from("access_logs")
        .select("accessed_at")
        .eq("user_id", userId)
        .gte("accessed_at", start.toISOString())
        .lte("accessed_at", end.toISOString());

      // Fetch events for partners
      let eventsData: any[] = [];
      if (userRole === "partner") {
        const { data } = await supabase
          .from("events")
          .select("created_at")
          .eq("partner_id", userId)
          .gte("created_at", start.toISOString())
          .lte("created_at", end.toISOString());
        eventsData = data || [];
      }

      // Group data by day
      const grouped: Record<string, ChartData> = {};

      // Initialize all dates in range
      const current = new Date(start);
      while (current <= end) {
        const key = format(current, "yyyy-MM-dd");
        const shortDate = format(current, days <= 7 ? "EEE" : "d MMM", { locale: es });
        grouped[key] = { date: key, shortDate, qr_codes: 0, accesses: 0, events: 0 };
        current.setDate(current.getDate() + 1);
      }

      // Group QR codes
      qrData?.forEach((qr) => {
        const date = format(new Date(qr.created_at), "yyyy-MM-dd");
        if (grouped[date]) {
          grouped[date].qr_codes++;
        }
      });

      // Group accesses
      accessData?.forEach((access) => {
        const date = format(new Date(access.accessed_at), "yyyy-MM-dd");
        if (grouped[date]) {
          grouped[date].accesses++;
        }
      });

      // Group events
      eventsData.forEach((event) => {
        const date = format(new Date(event.created_at), "yyyy-MM-dd");
        if (grouped[date]) {
          grouped[date].events = (grouped[date].events || 0) + 1;
        }
      });

      const dataArray = Object.values(grouped);
      setChartData(dataArray);
      
      // Calculate totals
      setTotals({
        qr: dataArray.reduce((sum, d) => sum + d.qr_codes, 0),
        accesses: dataArray.reduce((sum, d) => sum + d.accesses, 0),
        events: dataArray.reduce((sum, d) => sum + (d.events || 0), 0),
      });
    } catch (error) {
      console.error("Error fetching chart data:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto p-0">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="text-lg">{userName}</DialogTitle>
        </DialogHeader>

        <div className="px-4 pb-4 space-y-4">
          {/* Time Range Selector */}
          <div className="flex gap-2">
            {[
              { id: "7d", label: "7 días" },
              { id: "30d", label: "30 días" },
              { id: "90d", label: "90 días" },
            ].map((range) => (
              <button
                key={range.id}
                onClick={() => setTimeRange(range.id as any)}
                className={`flex-1 py-2 px-3 rounded-xl text-xs font-medium transition-all ${
                  timeRange === range.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-pulse text-muted-foreground text-sm">Cargando...</div>
            </div>
          ) : (
            <>
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-blue-500/10 rounded-xl p-3 text-center">
                  <QrCode className="w-4 h-4 text-blue-500 mx-auto mb-1" />
                  <p className="text-lg font-bold text-foreground">{totals.qr}</p>
                  <p className="text-[10px] text-muted-foreground">QR Codes</p>
                </div>
                <div className="bg-green-500/10 rounded-xl p-3 text-center">
                  <LogIn className="w-4 h-4 text-green-500 mx-auto mb-1" />
                  <p className="text-lg font-bold text-foreground">{totals.accesses}</p>
                  <p className="text-[10px] text-muted-foreground">Accesos</p>
                </div>
                {userRole === "partner" && (
                  <div className="bg-purple-500/10 rounded-xl p-3 text-center">
                    <Calendar className="w-4 h-4 text-purple-500 mx-auto mb-1" />
                    <p className="text-lg font-bold text-foreground">{totals.events}</p>
                    <p className="text-[10px] text-muted-foreground">Eventos</p>
                  </div>
                )}
              </div>

              {/* QR Codes Chart */}
              <div className="bg-muted/30 rounded-2xl p-4">
                <h4 className="text-sm font-medium mb-3 text-foreground">QR Codes</h4>
                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="qrGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <XAxis 
                        dataKey="shortDate" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                        interval="preserveStartEnd"
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                        allowDecimals={false}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Area 
                        type="monotone" 
                        dataKey="qr_codes" 
                        name="QR Codes"
                        stroke="hsl(var(--primary))" 
                        strokeWidth={2}
                        fill="url(#qrGradient)" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Accesses Chart */}
              <div className="bg-muted/30 rounded-2xl p-4">
                <h4 className="text-sm font-medium mb-3 text-foreground">Accesos</h4>
                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <XAxis 
                        dataKey="shortDate" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                        interval="preserveStartEnd"
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                        allowDecimals={false}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar 
                        dataKey="accesses" 
                        name="Accesos"
                        fill="hsl(142 76% 36%)" 
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Events Chart (Partners only) */}
              {userRole === "partner" && (
                <div className="bg-muted/30 rounded-2xl p-4">
                  <h4 className="text-sm font-medium mb-3 text-foreground">Eventos Creados</h4>
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="eventsGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(270 70% 60%)" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="hsl(270 70% 60%)" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <XAxis 
                          dataKey="shortDate" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                          interval="preserveStartEnd"
                        />
                        <YAxis 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                          allowDecimals={false}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Area 
                          type="monotone" 
                          dataKey="events" 
                          name="Eventos"
                          stroke="hsl(270 70% 60%)" 
                          strokeWidth={2}
                          fill="url(#eventsGradient)" 
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UserDetailChart;