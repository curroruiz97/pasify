export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_anomalies: {
        Row: {
          capability_code: string
          created_at: string
          detail: string | null
          id: string
          org_id: string | null
          payload: Json
          resolution_note: string | null
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          severity: Database["public"]["Enums"]["ai_anomaly_severity_t"]
          title: string
        }
        Insert: {
          capability_code: string
          created_at?: string
          detail?: string | null
          id?: string
          org_id?: string | null
          payload?: Json
          resolution_note?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity: Database["public"]["Enums"]["ai_anomaly_severity_t"]
          title: string
        }
        Update: {
          capability_code?: string
          created_at?: string
          detail?: string | null
          id?: string
          org_id?: string | null
          payload?: Json
          resolution_note?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["ai_anomaly_severity_t"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_anomalies_capability_code_fkey"
            columns: ["capability_code"]
            isOneToOne: false
            referencedRelation: "ai_capabilities"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "ai_anomalies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_anomalies_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_anomalies_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_audit_log: {
        Row: {
          action_summary: string
          capability_code: string
          completion_tokens: number | null
          created_at: string
          decision_id: string | null
          error_message: string | null
          id: string
          latency_ms: number | null
          model_version: string | null
          org_id: string | null
          prompt_tokens: number | null
          request_id: string | null
          result: Database["public"]["Enums"]["ai_audit_result_t"]
        }
        Insert: {
          action_summary: string
          capability_code: string
          completion_tokens?: number | null
          created_at?: string
          decision_id?: string | null
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          model_version?: string | null
          org_id?: string | null
          prompt_tokens?: number | null
          request_id?: string | null
          result: Database["public"]["Enums"]["ai_audit_result_t"]
        }
        Update: {
          action_summary?: string
          capability_code?: string
          completion_tokens?: number | null
          created_at?: string
          decision_id?: string | null
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          model_version?: string | null
          org_id?: string | null
          prompt_tokens?: number | null
          request_id?: string | null
          result?: Database["public"]["Enums"]["ai_audit_result_t"]
        }
        Relationships: [
          {
            foreignKeyName: "ai_audit_log_capability_code_fkey"
            columns: ["capability_code"]
            isOneToOne: false
            referencedRelation: "ai_capabilities"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "ai_audit_log_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "ai_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_capabilities: {
        Row: {
          code: string
          created_at: string
          description: string | null
          error_target_pct: number | null
          latency_target_ms: number | null
          model_name: string | null
          name: string
          precision_target: number | null
          provider: string | null
          status: Database["public"]["Enums"]["ai_capability_status_t"]
          updated_at: string
          version: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          error_target_pct?: number | null
          latency_target_ms?: number | null
          model_name?: string | null
          name: string
          precision_target?: number | null
          provider?: string | null
          status?: Database["public"]["Enums"]["ai_capability_status_t"]
          updated_at?: string
          version?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          error_target_pct?: number | null
          latency_target_ms?: number | null
          model_name?: string | null
          name?: string
          precision_target?: number | null
          provider?: string | null
          status?: Database["public"]["Enums"]["ai_capability_status_t"]
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      ai_decisions: {
        Row: {
          auto_approved_reason: string | null
          capability_code: string
          confidence: number | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          detail: string | null
          event_id: string | null
          executed_at: string | null
          execution_result: Json | null
          expires_at: string | null
          id: string
          impact_eur: number | null
          kind: string
          model_version: string | null
          needs_approval: boolean
          org_id: string | null
          payload: Json
          policy_scope: string | null
          status: Database["public"]["Enums"]["ai_decision_status_t"]
          title: string
          venue_id: string | null
        }
        Insert: {
          auto_approved_reason?: string | null
          capability_code: string
          confidence?: number | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          detail?: string | null
          event_id?: string | null
          executed_at?: string | null
          execution_result?: Json | null
          expires_at?: string | null
          id?: string
          impact_eur?: number | null
          kind: string
          model_version?: string | null
          needs_approval?: boolean
          org_id?: string | null
          payload?: Json
          policy_scope?: string | null
          status?: Database["public"]["Enums"]["ai_decision_status_t"]
          title: string
          venue_id?: string | null
        }
        Update: {
          auto_approved_reason?: string | null
          capability_code?: string
          confidence?: number | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          detail?: string | null
          event_id?: string | null
          executed_at?: string | null
          execution_result?: Json | null
          expires_at?: string | null
          id?: string
          impact_eur?: number | null
          kind?: string
          model_version?: string | null
          needs_approval?: boolean
          org_id?: string | null
          payload?: Json
          policy_scope?: string | null
          status?: Database["public"]["Enums"]["ai_decision_status_t"]
          title?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_decisions_capability_code_fkey"
            columns: ["capability_code"]
            isOneToOne: false
            referencedRelation: "ai_capabilities"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "ai_decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decisions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decisions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_revenue_summary"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "ai_decisions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decisions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_kill_switches: {
        Row: {
          capability_code: string
          killed: boolean
          killed_at: string | null
          killed_by: string | null
          reason: string | null
          updated_at: string
        }
        Insert: {
          capability_code: string
          killed?: boolean
          killed_at?: string | null
          killed_by?: string | null
          reason?: string | null
          updated_at?: string
        }
        Update: {
          capability_code?: string
          killed?: boolean
          killed_at?: string | null
          killed_by?: string | null
          reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_kill_switches_capability_code_fkey"
            columns: ["capability_code"]
            isOneToOne: true
            referencedRelation: "ai_capabilities"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "ai_kill_switches_killed_by_fkey"
            columns: ["killed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_kill_switches_killed_by_fkey"
            columns: ["killed_by"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_policies: {
        Row: {
          capability_code: string
          enabled: boolean
          id: string
          key: string
          org_id: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          capability_code: string
          enabled?: boolean
          id?: string
          key: string
          org_id: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          capability_code?: string
          enabled?: boolean
          id?: string
          key?: string
          org_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ai_policies_capability_code_fkey"
            columns: ["capability_code"]
            isOneToOne: false
            referencedRelation: "ai_capabilities"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "ai_policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      alerting_rules: {
        Row: {
          code: string
          comparator: string
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          last_triggered_at: string | null
          name: string
          notify_channels: Json
          query: string
          severity: string
          threshold: number | null
          updated_at: string
          window_seconds: number
        }
        Insert: {
          code: string
          comparator: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          last_triggered_at?: string | null
          name: string
          notify_channels?: Json
          query: string
          severity?: string
          threshold?: number | null
          updated_at?: string
          window_seconds?: number
        }
        Update: {
          code?: string
          comparator?: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          last_triggered_at?: string | null
          name?: string
          notify_channels?: Json
          query?: string
          severity?: string
          threshold?: number | null
          updated_at?: string
          window_seconds?: number
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      app_webhooks: {
        Row: {
          active: boolean
          created_at: string
          direction: string
          event_name: string
          id: string
          installed_app_id: string
          last_delivery_at: string | null
          last_delivery_status: string | null
          secret_hash: string | null
          target_url: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          direction: string
          event_name: string
          id?: string
          installed_app_id: string
          last_delivery_at?: string | null
          last_delivery_status?: string | null
          secret_hash?: string | null
          target_url?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          direction?: string
          event_name?: string
          id?: string
          installed_app_id?: string
          last_delivery_at?: string | null
          last_delivery_status?: string | null
          secret_hash?: string | null
          target_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_webhooks_installed_app_id_fkey"
            columns: ["installed_app_id"]
            isOneToOne: false
            referencedRelation: "installed_apps"
            referencedColumns: ["id"]
          },
        ]
      }
      application_fees_ledger: {
        Row: {
          amount_cents: number
          currency: string
          gross_cents: number
          id: string
          net_to_partner_cents: number
          org_id: string | null
          recorded_at: string
          refunded: boolean
          refunded_amount_cents: number
          refunded_at: string | null
          stripe_application_fee_id: string | null
          stripe_charge_id: string | null
          stripe_fee_cents: number
          stripe_payment_intent_id: string | null
          ticket_order_id: string | null
        }
        Insert: {
          amount_cents: number
          currency?: string
          gross_cents: number
          id?: string
          net_to_partner_cents: number
          org_id?: string | null
          recorded_at?: string
          refunded?: boolean
          refunded_amount_cents?: number
          refunded_at?: string | null
          stripe_application_fee_id?: string | null
          stripe_charge_id?: string | null
          stripe_fee_cents?: number
          stripe_payment_intent_id?: string | null
          ticket_order_id?: string | null
        }
        Update: {
          amount_cents?: number
          currency?: string
          gross_cents?: number
          id?: string
          net_to_partner_cents?: number
          org_id?: string | null
          recorded_at?: string
          refunded?: boolean
          refunded_amount_cents?: number
          refunded_at?: string | null
          stripe_application_fee_id?: string | null
          stripe_charge_id?: string | null
          stripe_fee_cents?: number
          stripe_payment_intent_id?: string | null
          ticket_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "application_fees_ledger_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_fees_ledger_ticket_order_id_fkey"
            columns: ["ticket_order_id"]
            isOneToOne: false
            referencedRelation: "ticket_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_role: string | null
          actor_user_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          ip_address: unknown
          org_id: string | null
          request_id: string | null
          target_id: string | null
          target_kind: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_role?: string | null
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          ip_address?: unknown
          org_id?: string | null
          request_id?: string | null
          target_id?: string | null
          target_kind?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_role?: string | null
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          ip_address?: unknown
          org_id?: string | null
          request_id?: string | null
          target_id?: string | null
          target_kind?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bars: {
        Row: {
          active: boolean
          created_at: string
          id: string
          kind: string
          name: string
          sort_order: number
          venue_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          kind?: string
          name: string
          sort_order?: number
          venue_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          kind?: string
          name?: string
          sort_order?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bars_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          accent_color: string | null
          bg_color: string | null
          cover_image_url: string | null
          created_at: string
          description: string | null
          favicon_url: string | null
          id: string
          ink_color: string | null
          instagram_handle: string | null
          logo_url: string | null
          metadata: Json
          name: string
          org_id: string
          primary_color: string | null
          slug: string
          sort_order: number
          spotify_artist_id: string | null
          status: string
          tagline: string | null
          tiktok_handle: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          accent_color?: string | null
          bg_color?: string | null
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          favicon_url?: string | null
          id?: string
          ink_color?: string | null
          instagram_handle?: string | null
          logo_url?: string | null
          metadata?: Json
          name: string
          org_id: string
          primary_color?: string | null
          slug: string
          sort_order?: number
          spotify_artist_id?: string | null
          status?: string
          tagline?: string | null
          tiktok_handle?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          accent_color?: string | null
          bg_color?: string | null
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          favicon_url?: string | null
          id?: string
          ink_color?: string | null
          instagram_handle?: string | null
          logo_url?: string | null
          metadata?: Json
          name?: string
          org_id?: string
          primary_color?: string | null
          slug?: string
          sort_order?: number
          spotify_artist_id?: string | null
          status?: string
          tagline?: string | null
          tiktok_handle?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brands_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bug_reports: {
        Row: {
          app_version: string | null
          console_logs: string | null
          created_at: string
          description: string
          id: string
          page: string | null
          resolution: string | null
          role: string | null
          screenshot_path: string | null
          status: string
          triaged_at: string | null
          triaged_by: string | null
          url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          console_logs?: string | null
          created_at?: string
          description: string
          id?: string
          page?: string | null
          resolution?: string | null
          role?: string | null
          screenshot_path?: string | null
          status?: string
          triaged_at?: string | null
          triaged_by?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          console_logs?: string | null
          created_at?: string
          description?: string
          id?: string
          page?: string | null
          resolution?: string | null
          role?: string | null
          screenshot_path?: string | null
          status?: string
          triaged_at?: string | null
          triaged_by?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bug_reports_triaged_by_fkey"
            columns: ["triaged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bug_reports_triaged_by_fkey"
            columns: ["triaged_by"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bug_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bug_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      business_categories: {
        Row: {
          code: string
          icon: string | null
          label_en: string
          label_es: string
          sort_order: number
        }
        Insert: {
          code: string
          icon?: string | null
          label_en: string
          label_es: string
          sort_order?: number
        }
        Update: {
          code?: string
          icon?: string | null
          label_en?: string
          label_es?: string
          sort_order?: number
        }
        Relationships: []
      }
      cashless_refunds: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          failure_reason: string | null
          id: string
          processed_at: string | null
          status: string
          stripe_refund_id: string | null
          wallet_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          failure_reason?: string | null
          id?: string
          processed_at?: string | null
          status?: string
          stripe_refund_id?: string | null
          wallet_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          failure_reason?: string | null
          id?: string
          processed_at?: string | null
          status?: string
          stripe_refund_id?: string | null
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cashless_refunds_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "cashless_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      cashless_topups: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          id: string
          partner_user_id: string | null
          request_id: string
          source: Database["public"]["Enums"]["cashless_topup_source_t"]
          stripe_payment_intent_id: string | null
          wallet_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          id?: string
          partner_user_id?: string | null
          request_id?: string
          source: Database["public"]["Enums"]["cashless_topup_source_t"]
          stripe_payment_intent_id?: string | null
          wallet_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: string
          partner_user_id?: string | null
          request_id?: string
          source?: Database["public"]["Enums"]["cashless_topup_source_t"]
          stripe_payment_intent_id?: string | null
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cashless_topups_partner_user_id_fkey"
            columns: ["partner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashless_topups_partner_user_id_fkey"
            columns: ["partner_user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashless_topups_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "cashless_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      cashless_transactions: {
        Row: {
          amount_cents: number
          bar_id: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["cashless_tx_kind_t"]
          partner_user_id: string | null
          pos_sale_id: string | null
          product_name: string | null
          request_id: string
          wallet_id: string
        }
        Insert: {
          amount_cents: number
          bar_id?: string | null
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["cashless_tx_kind_t"]
          partner_user_id?: string | null
          pos_sale_id?: string | null
          product_name?: string | null
          request_id?: string
          wallet_id: string
        }
        Update: {
          amount_cents?: number
          bar_id?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["cashless_tx_kind_t"]
          partner_user_id?: string | null
          pos_sale_id?: string | null
          product_name?: string | null
          request_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cashless_transactions_bar_id_fkey"
            columns: ["bar_id"]
            isOneToOne: false
            referencedRelation: "bars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashless_transactions_partner_user_id_fkey"
            columns: ["partner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashless_transactions_partner_user_id_fkey"
            columns: ["partner_user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashless_transactions_pos_sale_id_fkey"
            columns: ["pos_sale_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashless_transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "cashless_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      cashless_wallets: {
        Row: {
          balance_cents: number
          closed_at: string | null
          created_at: string
          currency: string
          event_id: string | null
          id: string
          pin_hash: string | null
          status: Database["public"]["Enums"]["cashless_wallet_status_t"]
          ticket_id: string | null
          user_id: string | null
          venue_id: string | null
          wristband_uid: string | null
        }
        Insert: {
          balance_cents?: number
          closed_at?: string | null
          created_at?: string
          currency?: string
          event_id?: string | null
          id?: string
          pin_hash?: string | null
          status?: Database["public"]["Enums"]["cashless_wallet_status_t"]
          ticket_id?: string | null
          user_id?: string | null
          venue_id?: string | null
          wristband_uid?: string | null
        }
        Update: {
          balance_cents?: number
          closed_at?: string | null
          created_at?: string
          currency?: string
          event_id?: string | null
          id?: string
          pin_hash?: string | null
          status?: Database["public"]["Enums"]["cashless_wallet_status_t"]
          ticket_id?: string | null
          user_id?: string | null
          venue_id?: string | null
          wristband_uid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cashless_wallets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashless_wallets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_revenue_summary"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "cashless_wallets_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashless_wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashless_wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashless_wallets_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      cities: {
        Row: {
          active: boolean
          country: string
          created_at: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          active?: boolean
          country?: string
          created_at?: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          active?: boolean
          country?: string
          created_at?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      compliance_age_policies: {
        Row: {
          bracelet_color: string | null
          created_at: string
          event_id: string | null
          id: string
          min_age: number
          notes: string | null
          org_id: string
          require_face_match: boolean
          require_id_check: boolean
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          bracelet_color?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          min_age: number
          notes?: string | null
          org_id: string
          require_face_match?: boolean
          require_id_check?: boolean
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          bracelet_color?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          min_age?: number
          notes?: string | null
          org_id?: string
          require_face_match?: boolean
          require_id_check?: boolean
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compliance_age_policies_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_age_policies_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_revenue_summary"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "compliance_age_policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_age_policies_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_consents: {
        Row: {
          consent_kind: string
          granted: boolean
          granted_at: string
          id: string
          ip_address: unknown
          user_agent: string | null
          user_id: string
          version: string
        }
        Insert: {
          consent_kind: string
          granted: boolean
          granted_at?: string
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id: string
          version: string
        }
        Update: {
          consent_kind?: string
          granted?: boolean
          granted_at?: string
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_dsar_requests: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          deadline_at: string
          export_path: string | null
          export_size_bytes: number | null
          id: string
          notes: string | null
          rejection_reason: string | null
          requester_email: string
          requester_user_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["dsar_status_t"]
          type: Database["public"]["Enums"]["dsar_type_t"]
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          deadline_at?: string
          export_path?: string | null
          export_size_bytes?: number | null
          id?: string
          notes?: string | null
          rejection_reason?: string | null
          requester_email: string
          requester_user_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["dsar_status_t"]
          type: Database["public"]["Enums"]["dsar_type_t"]
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          deadline_at?: string
          export_path?: string | null
          export_size_bytes?: number | null
          id?: string
          notes?: string | null
          rejection_reason?: string | null
          requester_email?: string
          requester_user_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["dsar_status_t"]
          type?: Database["public"]["Enums"]["dsar_type_t"]
        }
        Relationships: [
          {
            foreignKeyName: "compliance_dsar_requests_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_dsar_requests_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_dsar_requests_requester_user_id_fkey"
            columns: ["requester_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_dsar_requests_requester_user_id_fkey"
            columns: ["requester_user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_runs: {
        Row: {
          finished_at: string | null
          id: string
          job_name: string
          message: string | null
          metadata: Json
          started_at: string
          status: string
        }
        Insert: {
          finished_at?: string | null
          id?: string
          job_name: string
          message?: string | null
          metadata?: Json
          started_at?: string
          status?: string
        }
        Update: {
          finished_at?: string | null
          id?: string
          job_name?: string
          message?: string | null
          metadata?: Json
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      door_scans: {
        Row: {
          device_id: string | null
          event_id: string
          geo_lat: number | null
          geo_lng: number | null
          id: string
          reason: string | null
          request_id: string
          result: Database["public"]["Enums"]["door_scan_result_t"]
          scanned_at: string
          scanner_user_id: string | null
          ticket_id: string | null
          venue_id: string | null
        }
        Insert: {
          device_id?: string | null
          event_id: string
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          reason?: string | null
          request_id?: string
          result: Database["public"]["Enums"]["door_scan_result_t"]
          scanned_at?: string
          scanner_user_id?: string | null
          ticket_id?: string | null
          venue_id?: string | null
        }
        Update: {
          device_id?: string | null
          event_id?: string
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          reason?: string | null
          request_id?: string
          result?: Database["public"]["Enums"]["door_scan_result_t"]
          scanned_at?: string
          scanner_user_id?: string | null
          ticket_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "door_scans_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "door_scans_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_revenue_summary"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "door_scans_scanner_user_id_fkey"
            columns: ["scanner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "door_scans_scanner_user_id_fkey"
            columns: ["scanner_user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "door_scans_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "door_scans_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      door_vision_events: {
        Row: {
          action_taken: string | null
          confidence: number | null
          demographics: Json
          event_id: string
          id: string
          kind: Database["public"]["Enums"]["door_vision_kind_t"]
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_decision: string | null
          scanner_user_id: string | null
          snapshot_path: string | null
          ticket_id: string | null
          ts: string
          venue_id: string | null
        }
        Insert: {
          action_taken?: string | null
          confidence?: number | null
          demographics?: Json
          event_id: string
          id?: string
          kind: Database["public"]["Enums"]["door_vision_kind_t"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_decision?: string | null
          scanner_user_id?: string | null
          snapshot_path?: string | null
          ticket_id?: string | null
          ts?: string
          venue_id?: string | null
        }
        Update: {
          action_taken?: string | null
          confidence?: number | null
          demographics?: Json
          event_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["door_vision_kind_t"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_decision?: string | null
          scanner_user_id?: string | null
          snapshot_path?: string | null
          ticket_id?: string | null
          ts?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "door_vision_events_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "door_vision_events_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_revenue_summary"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "door_vision_events_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "door_vision_events_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "door_vision_events_scanner_user_id_fkey"
            columns: ["scanner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "door_vision_events_scanner_user_id_fkey"
            columns: ["scanner_user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "door_vision_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "door_vision_events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      errors_i18n: {
        Row: {
          code: string
          de: string | null
          en: string
          es: string
          fr: string | null
          it: string | null
          pt: string | null
        }
        Insert: {
          code: string
          de?: string | null
          en: string
          es: string
          fr?: string | null
          it?: string | null
          pt?: string | null
        }
        Update: {
          code?: string
          de?: string | null
          en?: string
          es?: string
          fr?: string | null
          it?: string | null
          pt?: string | null
        }
        Relationships: []
      }
      event_categories: {
        Row: {
          code: string
          icon: string | null
          label_en: string
          label_es: string
          sort_order: number
        }
        Insert: {
          code: string
          icon?: string | null
          label_en: string
          label_es: string
          sort_order?: number
        }
        Update: {
          code?: string
          icon?: string | null
          label_en?: string
          label_es?: string
          sort_order?: number
        }
        Relationships: []
      }
      events: {
        Row: {
          address: string | null
          brand_id: string | null
          capacity: number | null
          category: string | null
          city: string
          created_at: string
          currency: string
          date_end: string | null
          date_start: string
          description: string | null
          festival_parent_id: string | null
          id: string
          image_url: string | null
          is_festival: boolean
          metadata: Json
          org_id: string | null
          partner_id: string
          price_cents: number
          status: Database["public"]["Enums"]["event_status_t"]
          stripe_price_id: string | null
          tickets_sold: number
          title: string
          updated_at: string
          venue_id: string | null
          venue_name: string | null
        }
        Insert: {
          address?: string | null
          brand_id?: string | null
          capacity?: number | null
          category?: string | null
          city: string
          created_at?: string
          currency?: string
          date_end?: string | null
          date_start: string
          description?: string | null
          festival_parent_id?: string | null
          id?: string
          image_url?: string | null
          is_festival?: boolean
          metadata?: Json
          org_id?: string | null
          partner_id: string
          price_cents?: number
          status?: Database["public"]["Enums"]["event_status_t"]
          stripe_price_id?: string | null
          tickets_sold?: number
          title: string
          updated_at?: string
          venue_id?: string | null
          venue_name?: string | null
        }
        Update: {
          address?: string | null
          brand_id?: string | null
          capacity?: number | null
          category?: string | null
          city?: string
          created_at?: string
          currency?: string
          date_end?: string | null
          date_start?: string
          description?: string | null
          festival_parent_id?: string | null
          id?: string
          image_url?: string | null
          is_festival?: boolean
          metadata?: Json
          org_id?: string | null
          partner_id?: string
          price_cents?: number
          status?: Database["public"]["Enums"]["event_status_t"]
          stripe_price_id?: string | null
          tickets_sold?: number
          title?: string
          updated_at?: string
          venue_id?: string | null
          venue_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_festival_parent_id_fkey"
            columns: ["festival_parent_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_festival_parent_id_fkey"
            columns: ["festival_parent_id"]
            isOneToOne: false
            referencedRelation: "v_event_revenue_summary"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites_v2: {
        Row: {
          brand_id: string | null
          created_at: string
          event_id: string | null
          id: string
          user_id: string
          venue_id: string | null
        }
        Insert: {
          brand_id?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          user_id: string
          venue_id?: string | null
        }
        Update: {
          brand_id?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          user_id?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "favorites_v2_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_v2_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_v2_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_revenue_summary"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "favorites_v2_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_v2_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_v2_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          code: string
          created_at: string
          description: string | null
          enabled: boolean
          name: string
          rollout_pct: number
          tenant_overrides: Json
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          name: string
          rollout_pct?: number
          tenant_overrides?: Json
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          name?: string
          rollout_pct?: number
          tenant_overrides?: Json
          updated_at?: string
        }
        Relationships: []
      }
      forecast_predictions: {
        Row: {
          ci_high: number | null
          ci_low: number | null
          confidence: number | null
          event_id: string
          factors: Json
          generated_at: string
          id: string
          model_version: string | null
          predicted_attendance: number
          predicted_revenue_cents: number | null
        }
        Insert: {
          ci_high?: number | null
          ci_low?: number | null
          confidence?: number | null
          event_id: string
          factors?: Json
          generated_at?: string
          id?: string
          model_version?: string | null
          predicted_attendance: number
          predicted_revenue_cents?: number | null
        }
        Update: {
          ci_high?: number | null
          ci_low?: number | null
          confidence?: number | null
          event_id?: string
          factors?: Json
          generated_at?: string
          id?: string
          model_version?: string | null
          predicted_attendance?: number
          predicted_revenue_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "forecast_predictions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_predictions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_revenue_summary"
            referencedColumns: ["event_id"]
          },
        ]
      }
      help_faq: {
        Row: {
          active: boolean
          body: string
          created_at: string
          id: string
          role: string
          slug: string
          sort_order: number
          tag: string | null
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          body: string
          created_at?: string
          id?: string
          role: string
          slug: string
          sort_order?: number
          tag?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          body?: string
          created_at?: string
          id?: string
          role?: string
          slug?: string
          sort_order?: number
          tag?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      industry_benchmarks_snapshots: {
        Row: {
          computed_at: string
          id: string
          k_anonymity_min: number
          payload: Json
          region: string
          sample_size: number
          segment: string
        }
        Insert: {
          computed_at?: string
          id?: string
          k_anonymity_min?: number
          payload: Json
          region: string
          sample_size: number
          segment: string
        }
        Update: {
          computed_at?: string
          id?: string
          k_anonymity_min?: number
          payload?: Json
          region?: string
          sample_size?: number
          segment?: string
        }
        Relationships: []
      }
      installed_apps: {
        Row: {
          app_code: string
          app_id: string
          config: Json
          disconnected_at: string | null
          id: string
          installed_at: string
          installed_by: string | null
          last_error: string | null
          last_sync_at: string | null
          last_sync_status: string | null
          oauth_credentials_encrypted: string | null
          org_id: string
          status: Database["public"]["Enums"]["installed_app_status_t"]
        }
        Insert: {
          app_code: string
          app_id: string
          config?: Json
          disconnected_at?: string | null
          id?: string
          installed_at?: string
          installed_by?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          last_sync_status?: string | null
          oauth_credentials_encrypted?: string | null
          org_id: string
          status?: Database["public"]["Enums"]["installed_app_status_t"]
        }
        Update: {
          app_code?: string
          app_id?: string
          config?: Json
          disconnected_at?: string | null
          id?: string
          installed_at?: string
          installed_by?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          last_sync_status?: string | null
          oauth_credentials_encrypted?: string | null
          org_id?: string
          status?: Database["public"]["Enums"]["installed_app_status_t"]
        }
        Relationships: [
          {
            foreignKeyName: "installed_apps_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "marketplace_apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installed_apps_installed_by_fkey"
            columns: ["installed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installed_apps_installed_by_fkey"
            columns: ["installed_by"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installed_apps_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_levels: {
        Row: {
          code: string
          color: string | null
          id: string
          min_points: number
          name: string
          perks: Json
          sort_order: number
        }
        Insert: {
          code: string
          color?: string | null
          id?: string
          min_points: number
          name: string
          perks?: Json
          sort_order?: number
        }
        Update: {
          code?: string
          color?: string | null
          id?: string
          min_points?: number
          name?: string
          perks?: Json
          sort_order?: number
        }
        Relationships: []
      }
      loyalty_points: {
        Row: {
          balance_after: number
          change_amount: number
          created_at: string
          event_id: string | null
          expires_at: string | null
          id: string
          org_id: string | null
          reason: string
          reason_code: string | null
          ticket_id: string | null
          user_id: string
        }
        Insert: {
          balance_after: number
          change_amount: number
          created_at?: string
          event_id?: string | null
          expires_at?: string | null
          id?: string
          org_id?: string | null
          reason: string
          reason_code?: string | null
          ticket_id?: string | null
          user_id: string
        }
        Update: {
          balance_after?: number
          change_amount?: number
          created_at?: string
          event_id?: string | null
          expires_at?: string | null
          id?: string
          org_id?: string | null
          reason?: string
          reason_code?: string | null
          ticket_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_points_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_points_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_revenue_summary"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "loyalty_points_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_points_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_points_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_points_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_campaigns: {
        Row: {
          audience_definition: Json
          budget_cents: number
          budget_consumed_cents: number
          channel: Database["public"]["Enums"]["marketing_channel_t"]
          click_count: number
          completed_at: string | null
          content: Json
          conversions_count: number
          conversions_revenue_cents: number
          created_at: string
          created_by: string | null
          delivered_count: number
          event_id: string | null
          id: string
          name: string
          open_count: number
          org_id: string
          scheduled_at: string | null
          sent_count: number
          started_at: string | null
          status: Database["public"]["Enums"]["marketing_campaign_status_t"]
          updated_at: string
        }
        Insert: {
          audience_definition?: Json
          budget_cents?: number
          budget_consumed_cents?: number
          channel: Database["public"]["Enums"]["marketing_channel_t"]
          click_count?: number
          completed_at?: string | null
          content?: Json
          conversions_count?: number
          conversions_revenue_cents?: number
          created_at?: string
          created_by?: string | null
          delivered_count?: number
          event_id?: string | null
          id?: string
          name: string
          open_count?: number
          org_id: string
          scheduled_at?: string | null
          sent_count?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["marketing_campaign_status_t"]
          updated_at?: string
        }
        Update: {
          audience_definition?: Json
          budget_cents?: number
          budget_consumed_cents?: number
          channel?: Database["public"]["Enums"]["marketing_channel_t"]
          click_count?: number
          completed_at?: string | null
          content?: Json
          conversions_count?: number
          conversions_revenue_cents?: number
          created_at?: string
          created_by?: string | null
          delivered_count?: number
          event_id?: string | null
          id?: string
          name?: string
          open_count?: number
          org_id?: string
          scheduled_at?: string | null
          sent_count?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["marketing_campaign_status_t"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_revenue_summary"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "marketing_campaigns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_apps: {
        Row: {
          category: string
          code: string
          created_at: string
          currency: string
          description: string | null
          documentation_url: string | null
          featured: boolean
          features: Json
          icon_color: string | null
          icon_slug: string | null
          id: string
          monthly_price_cents: number | null
          name: string
          oauth_provider: string | null
          official: boolean
          popular: boolean
          scopes_required: Json
          short_description: string | null
          sort_order: number
          status: Database["public"]["Enums"]["marketplace_app_status_t"]
          support_email: string | null
          updated_at: string
        }
        Insert: {
          category: string
          code: string
          created_at?: string
          currency?: string
          description?: string | null
          documentation_url?: string | null
          featured?: boolean
          features?: Json
          icon_color?: string | null
          icon_slug?: string | null
          id?: string
          monthly_price_cents?: number | null
          name: string
          oauth_provider?: string | null
          official?: boolean
          popular?: boolean
          scopes_required?: Json
          short_description?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["marketplace_app_status_t"]
          support_email?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          currency?: string
          description?: string | null
          documentation_url?: string | null
          featured?: boolean
          features?: Json
          icon_color?: string | null
          icon_slug?: string | null
          id?: string
          monthly_price_cents?: number | null
          name?: string
          oauth_provider?: string | null
          official?: boolean
          popular?: boolean
          scopes_required?: Json
          short_description?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["marketplace_app_status_t"]
          support_email?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      media_renditions: {
        Row: {
          bucket: string
          format: string | null
          generated_at: string
          height: number | null
          id: string
          path: string
          size_bytes: number | null
          source_path: string
          variant: string
          width: number | null
        }
        Insert: {
          bucket: string
          format?: string | null
          generated_at?: string
          height?: number | null
          id?: string
          path: string
          size_bytes?: number | null
          source_path: string
          variant: string
          width?: number | null
        }
        Update: {
          bucket?: string
          format?: string | null
          generated_at?: string
          height?: number | null
          id?: string
          path?: string
          size_bytes?: number | null
          source_path?: string
          variant?: string
          width?: number | null
        }
        Relationships: []
      }
      moderation_flags: {
        Row: {
          created_at: string
          details: string | null
          id: string
          reason: string
          reporter_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          target_id: string | null
          target_kind: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          reason: string
          reporter_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          target_id?: string | null
          target_kind: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          reason?: string
          reporter_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          target_id?: string | null
          target_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderation_flags_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_flags_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_flags_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_flags_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      music_genres: {
        Row: {
          code: string
          color: string | null
          label_en: string
          label_es: string
          parent_code: string | null
          sort_order: number
        }
        Insert: {
          code: string
          color?: string | null
          label_en: string
          label_es: string
          parent_code?: string | null
          sort_order?: number
        }
        Update: {
          code?: string
          color?: string | null
          label_en?: string
          label_es?: string
          parent_code?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "music_genres_parent_code_fkey"
            columns: ["parent_code"]
            isOneToOne: false
            referencedRelation: "music_genres"
            referencedColumns: ["code"]
          },
        ]
      }
      music_licenses: {
        Row: {
          agency: string
          annual_fee_cents: number | null
          country: string
          created_at: string
          document_path: string | null
          expiry_date: string | null
          id: string
          license_number: string
          notes: string | null
          org_id: string
          start_date: string | null
          status: string
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          agency: string
          annual_fee_cents?: number | null
          country?: string
          created_at?: string
          document_path?: string | null
          expiry_date?: string | null
          id?: string
          license_number: string
          notes?: string | null
          org_id: string
          start_date?: string | null
          status?: string
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          agency?: string
          annual_fee_cents?: number | null
          country?: string
          created_at?: string
          document_path?: string | null
          expiry_date?: string | null
          id?: string
          license_number?: string
          notes?: string | null
          org_id?: string
          start_date?: string | null
          status?: string
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "music_licenses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "music_licenses_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_dispatches: {
        Row: {
          attempt_count: number
          channel: Database["public"]["Enums"]["notification_channel_t"]
          created_at: string
          delivered_at: string | null
          dispatched_at: string | null
          error_message: string | null
          id: string
          next_retry_at: string | null
          notification_id: string
          provider: string | null
          provider_message_id: string | null
          status: Database["public"]["Enums"]["notification_status_t"]
        }
        Insert: {
          attempt_count?: number
          channel: Database["public"]["Enums"]["notification_channel_t"]
          created_at?: string
          delivered_at?: string | null
          dispatched_at?: string | null
          error_message?: string | null
          id?: string
          next_retry_at?: string | null
          notification_id: string
          provider?: string | null
          provider_message_id?: string | null
          status?: Database["public"]["Enums"]["notification_status_t"]
        }
        Update: {
          attempt_count?: number
          channel?: Database["public"]["Enums"]["notification_channel_t"]
          created_at?: string
          delivered_at?: string | null
          dispatched_at?: string | null
          error_message?: string | null
          id?: string
          next_retry_at?: string | null
          notification_id?: string
          provider?: string | null
          provider_message_id?: string | null
          status?: Database["public"]["Enums"]["notification_status_t"]
        }
        Relationships: [
          {
            foreignKeyName: "notification_dispatches_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          category: string
          created_at: string
          expires_at: string | null
          icon: string | null
          id: string
          kind: string
          link: string | null
          payload: Json
          priority: string
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          category: string
          created_at?: string
          expires_at?: string | null
          icon?: string | null
          id?: string
          kind: string
          link?: string | null
          payload?: Json
          priority?: string
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          category?: string
          created_at?: string
          expires_at?: string | null
          icon?: string | null
          id?: string
          kind?: string
          link?: string | null
          payload?: Json
          priority?: string
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          accepted_at: string | null
          brand_id: string | null
          created_at: string
          email: string
          id: string
          invitation_expires_at: string | null
          invitation_token: string | null
          invited_at: string
          invited_by: string | null
          org_id: string
          removed_at: string | null
          role: Database["public"]["Enums"]["org_member_role_t"]
          status: string
          updated_at: string
          user_id: string | null
          venue_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          brand_id?: string | null
          created_at?: string
          email: string
          id?: string
          invitation_expires_at?: string | null
          invitation_token?: string | null
          invited_at?: string
          invited_by?: string | null
          org_id: string
          removed_at?: string | null
          role: Database["public"]["Enums"]["org_member_role_t"]
          status?: string
          updated_at?: string
          user_id?: string | null
          venue_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          brand_id?: string | null
          created_at?: string
          email?: string
          id?: string
          invitation_expires_at?: string | null
          invitation_token?: string | null
          invited_at?: string
          invited_by?: string | null
          org_id?: string
          removed_at?: string | null
          role?: Database["public"]["Enums"]["org_member_role_t"]
          status?: string
          updated_at?: string
          user_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          billing_email: string | null
          city: string | null
          contact_email: string | null
          contact_phone: string | null
          country: string
          created_at: string
          id: string
          legal_name: string | null
          metadata: Json
          name: string
          owner_id: string
          postal_code: string | null
          slug: string
          status: string
          stripe_connect_account_id: string | null
          stripe_connect_charges_enabled: boolean
          stripe_connect_onboarded: boolean
          stripe_connect_payouts_enabled: boolean
          stripe_customer_id: string | null
          subscription_current_period_end: string | null
          subscription_plan_code: string | null
          subscription_status: string | null
          tier: string
          trial_ends_at: string | null
          updated_at: string
          vat_id: string | null
        }
        Insert: {
          address?: string | null
          billing_email?: string | null
          city?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          country?: string
          created_at?: string
          id?: string
          legal_name?: string | null
          metadata?: Json
          name: string
          owner_id: string
          postal_code?: string | null
          slug: string
          status?: string
          stripe_connect_account_id?: string | null
          stripe_connect_charges_enabled?: boolean
          stripe_connect_onboarded?: boolean
          stripe_connect_payouts_enabled?: boolean
          stripe_customer_id?: string | null
          subscription_current_period_end?: string | null
          subscription_plan_code?: string | null
          subscription_status?: string | null
          tier?: string
          trial_ends_at?: string | null
          updated_at?: string
          vat_id?: string | null
        }
        Update: {
          address?: string | null
          billing_email?: string | null
          city?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          country?: string
          created_at?: string
          id?: string
          legal_name?: string | null
          metadata?: Json
          name?: string
          owner_id?: string
          postal_code?: string | null
          slug?: string
          status?: string
          stripe_connect_account_id?: string | null
          stripe_connect_charges_enabled?: boolean
          stripe_connect_onboarded?: boolean
          stripe_connect_payouts_enabled?: boolean
          stripe_customer_id?: string | null
          subscription_current_period_end?: string | null
          subscription_plan_code?: string | null
          subscription_status?: string | null
          tier?: string
          trial_ends_at?: string | null
          updated_at?: string
          vat_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_favorites: {
        Row: {
          created_at: string
          id: string
          org_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_favorites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_galleries: {
        Row: {
          brand_id: string
          caption: string | null
          created_at: string
          id: string
          image_url: string
          sort_order: number
          venue_id: string | null
        }
        Insert: {
          brand_id: string
          caption?: string | null
          created_at?: string
          id?: string
          image_url: string
          sort_order?: number
          venue_id?: string | null
        }
        Update: {
          brand_id?: string
          caption?: string | null
          created_at?: string
          id?: string
          image_url?: string
          sort_order?: number
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_galleries_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_galleries_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_onboarding_state: {
        Row: {
          completed_at: string | null
          created_at: string
          current_step: string | null
          data: Json
          id: string
          org_id: string | null
          status: string
          updated_at: string
          user_id: string
          venue_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_step?: string | null
          data?: Json
          id?: string
          org_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
          venue_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_step?: string | null
          data?: Json
          id?: string
          org_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_onboarding_state_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_onboarding_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_onboarding_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_onboarding_state_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_subscriptions: {
        Row: {
          admin_grant_note: string | null
          admin_granted_by: string | null
          admin_granted_until: string | null
          billing_interval: string
          cancel_at_period_end: boolean
          cancelled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          last_payment_amount_cents: number | null
          last_payment_at: string | null
          last_payment_failure_reason: string | null
          metadata: Json
          org_id: string
          paused_at: string | null
          plan_code: string | null
          plan_id: string | null
          status: Database["public"]["Enums"]["partner_subscription_status_t"]
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          trial_starts_at: string | null
          updated_at: string
        }
        Insert: {
          admin_grant_note?: string | null
          admin_granted_by?: string | null
          admin_granted_until?: string | null
          billing_interval?: string
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          last_payment_amount_cents?: number | null
          last_payment_at?: string | null
          last_payment_failure_reason?: string | null
          metadata?: Json
          org_id: string
          paused_at?: string | null
          plan_code?: string | null
          plan_id?: string | null
          status?: Database["public"]["Enums"]["partner_subscription_status_t"]
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          trial_starts_at?: string | null
          updated_at?: string
        }
        Update: {
          admin_grant_note?: string | null
          admin_granted_by?: string | null
          admin_granted_until?: string | null
          billing_interval?: string
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          last_payment_amount_cents?: number | null
          last_payment_at?: string | null
          last_payment_failure_reason?: string | null
          metadata?: Json
          org_id?: string
          paused_at?: string | null
          plan_code?: string | null
          plan_id?: string | null
          status?: Database["public"]["Enums"]["partner_subscription_status_t"]
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          trial_starts_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_subscriptions_admin_granted_by_fkey"
            columns: ["admin_granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_subscriptions_admin_granted_by_fkey"
            columns: ["admin_granted_by"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_schedules: {
        Row: {
          currency: string
          frequency: string
          min_amount_cents: number
          monthly_day: number | null
          org_id: string
          updated_at: string
          weekly_day: number | null
        }
        Insert: {
          currency?: string
          frequency?: string
          min_amount_cents?: number
          monthly_day?: number | null
          org_id: string
          updated_at?: string
          weekly_day?: number | null
        }
        Update: {
          currency?: string
          frequency?: string
          min_amount_cents?: number
          monthly_day?: number | null
          org_id?: string
          updated_at?: string
          weekly_day?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payout_schedules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_cash_closures: {
        Row: {
          closed_at: string
          counted_cash_cents: number
          created_at: string
          event_id: string | null
          expected_cash_cents: number
          id: string
          notes: string | null
          opened_at: string
          partner_user_id: string | null
          total_card_cents: number
          total_complimentary_cents: number
          total_sales_count: number
          total_wristband_cents: number
          variance_cents: number | null
          venue_id: string
        }
        Insert: {
          closed_at?: string
          counted_cash_cents?: number
          created_at?: string
          event_id?: string | null
          expected_cash_cents?: number
          id?: string
          notes?: string | null
          opened_at: string
          partner_user_id?: string | null
          total_card_cents?: number
          total_complimentary_cents?: number
          total_sales_count?: number
          total_wristband_cents?: number
          variance_cents?: number | null
          venue_id: string
        }
        Update: {
          closed_at?: string
          counted_cash_cents?: number
          created_at?: string
          event_id?: string | null
          expected_cash_cents?: number
          id?: string
          notes?: string | null
          opened_at?: string
          partner_user_id?: string | null
          total_card_cents?: number
          total_complimentary_cents?: number
          total_sales_count?: number
          total_wristband_cents?: number
          variance_cents?: number | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_cash_closures_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_cash_closures_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_revenue_summary"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "pos_cash_closures_partner_user_id_fkey"
            columns: ["partner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_cash_closures_partner_user_id_fkey"
            columns: ["partner_user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_cash_closures_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_sales: {
        Row: {
          bar_id: string | null
          cashier_user_id: string | null
          created_at: string
          currency: string
          event_id: string | null
          id: string
          items: Json
          payment_method: Database["public"]["Enums"]["pos_payment_method_t"]
          request_id: string
          stripe_payment_intent_id: string | null
          subtotal_cents: number
          ticket_id: string | null
          total_cents: number
          vat_cents: number
          venue_id: string
          voided: boolean
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          bar_id?: string | null
          cashier_user_id?: string | null
          created_at?: string
          currency?: string
          event_id?: string | null
          id?: string
          items?: Json
          payment_method: Database["public"]["Enums"]["pos_payment_method_t"]
          request_id?: string
          stripe_payment_intent_id?: string | null
          subtotal_cents?: number
          ticket_id?: string | null
          total_cents?: number
          vat_cents?: number
          venue_id: string
          voided?: boolean
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          bar_id?: string | null
          cashier_user_id?: string | null
          created_at?: string
          currency?: string
          event_id?: string | null
          id?: string
          items?: Json
          payment_method?: Database["public"]["Enums"]["pos_payment_method_t"]
          request_id?: string
          stripe_payment_intent_id?: string | null
          subtotal_cents?: number
          ticket_id?: string | null
          total_cents?: number
          vat_cents?: number
          venue_id?: string
          voided?: boolean
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_sales_bar_id_fkey"
            columns: ["bar_id"]
            isOneToOne: false
            referencedRelation: "bars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_cashier_user_id_fkey"
            columns: ["cashier_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_cashier_user_id_fkey"
            columns: ["cashier_user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_revenue_summary"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "pos_sales_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_proposals: {
        Row: {
          applied_at: string | null
          confidence: number | null
          created_at: string
          current_price_cents: number
          decided_at: string | null
          decided_by: string | null
          delta_pct: number | null
          event_id: string
          expected_tickets_uplift: number | null
          expected_uplift_cents: number | null
          expires_at: string
          id: string
          rationale: string | null
          status: string
          suggested_price_cents: number
          tier_id: string | null
        }
        Insert: {
          applied_at?: string | null
          confidence?: number | null
          created_at?: string
          current_price_cents: number
          decided_at?: string | null
          decided_by?: string | null
          delta_pct?: number | null
          event_id: string
          expected_tickets_uplift?: number | null
          expected_uplift_cents?: number | null
          expires_at?: string
          id?: string
          rationale?: string | null
          status?: string
          suggested_price_cents: number
          tier_id?: string | null
        }
        Update: {
          applied_at?: string | null
          confidence?: number | null
          created_at?: string
          current_price_cents?: number
          decided_at?: string | null
          decided_by?: string | null
          delta_pct?: number | null
          event_id?: string
          expected_tickets_uplift?: number | null
          expected_uplift_cents?: number | null
          expires_at?: string
          id?: string
          rationale?: string | null
          status?: string
          suggested_price_cents?: number
          tier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pricing_proposals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_proposals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_proposals_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_proposals_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_revenue_summary"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "pricing_proposals_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "ticket_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          available: boolean
          bar_id: string | null
          category: string | null
          created_at: string
          currency: string
          id: string
          image_url: string | null
          name: string
          price_cents: number
          sku: string | null
          sort_order: number
          updated_at: string
          vat_pct: number
          venue_id: string
        }
        Insert: {
          available?: boolean
          bar_id?: string | null
          category?: string | null
          created_at?: string
          currency?: string
          id?: string
          image_url?: string | null
          name: string
          price_cents?: number
          sku?: string | null
          sort_order?: number
          updated_at?: string
          vat_pct?: number
          venue_id: string
        }
        Update: {
          available?: boolean
          bar_id?: string | null
          category?: string | null
          created_at?: string
          currency?: string
          id?: string
          image_url?: string | null
          name?: string
          price_cents?: number
          sku?: string | null
          sort_order?: number
          updated_at?: string
          vat_pct?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_bar_id_fkey"
            columns: ["bar_id"]
            isOneToOne: false
            referencedRelation: "bars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_status: Database["public"]["Enums"]["account_status_t"]
          avatar_url: string | null
          business_address: string | null
          business_category: string | null
          business_city: string | null
          business_country: string | null
          business_description: string | null
          business_name: string | null
          business_phone: string | null
          city: string | null
          country: string | null
          cover_image_url: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          last_active_venue_id: string | null
          last_name: string | null
          phone: string | null
          stripe_connect_account_id: string | null
          stripe_connect_onboarded: boolean | null
          stripe_customer_id: string | null
          subscription_current_period_end: string | null
          subscription_status: string | null
          updated_at: string
        }
        Insert: {
          account_status?: Database["public"]["Enums"]["account_status_t"]
          avatar_url?: string | null
          business_address?: string | null
          business_category?: string | null
          business_city?: string | null
          business_country?: string | null
          business_description?: string | null
          business_name?: string | null
          business_phone?: string | null
          city?: string | null
          country?: string | null
          cover_image_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id: string
          last_active_venue_id?: string | null
          last_name?: string | null
          phone?: string | null
          stripe_connect_account_id?: string | null
          stripe_connect_onboarded?: boolean | null
          stripe_customer_id?: string | null
          subscription_current_period_end?: string | null
          subscription_status?: string | null
          updated_at?: string
        }
        Update: {
          account_status?: Database["public"]["Enums"]["account_status_t"]
          avatar_url?: string | null
          business_address?: string | null
          business_category?: string | null
          business_city?: string | null
          business_country?: string | null
          business_description?: string | null
          business_name?: string | null
          business_phone?: string | null
          city?: string | null
          country?: string | null
          cover_image_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_active_venue_id?: string | null
          last_name?: string | null
          phone?: string | null
          stripe_connect_account_id?: string | null
          stripe_connect_onboarded?: boolean | null
          stripe_customer_id?: string | null
          subscription_current_period_end?: string | null
          subscription_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_last_active_venue_fk"
            columns: ["last_active_venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          count: number
          expires_at: string
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          expires_at: string
          key: string
          window_start?: string
        }
        Update: {
          count?: number
          expires_at?: string
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      refund_request_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          request_id: string
          sender_id: string | null
          sender_kind: Database["public"]["Enums"]["refund_request_sender_t"]
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          request_id: string
          sender_id?: string | null
          sender_kind: Database["public"]["Enums"]["refund_request_sender_t"]
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          request_id?: string
          sender_id?: string | null
          sender_kind?: Database["public"]["Enums"]["refund_request_sender_t"]
        }
        Relationships: [
          {
            foreignKeyName: "refund_request_messages_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "refund_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_request_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_request_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_requests: {
        Row: {
          amount_cents: number
          auto_approve_reason: string | null
          auto_approved: boolean
          created_at: string
          currency: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          event_id: string
          id: string
          metadata: Json
          order_id: string | null
          org_id: string | null
          processed_at: string | null
          reason: string
          reason_code: string | null
          requester_email: string
          requester_user_id: string
          status: Database["public"]["Enums"]["refund_request_status_t"]
          stripe_failure_reason: string | null
          stripe_refund_id: string | null
          stripe_refund_status: string | null
          ticket_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          auto_approve_reason?: string | null
          auto_approved?: boolean
          created_at?: string
          currency?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          event_id: string
          id?: string
          metadata?: Json
          order_id?: string | null
          org_id?: string | null
          processed_at?: string | null
          reason: string
          reason_code?: string | null
          requester_email: string
          requester_user_id: string
          status?: Database["public"]["Enums"]["refund_request_status_t"]
          stripe_failure_reason?: string | null
          stripe_refund_id?: string | null
          stripe_refund_status?: string | null
          ticket_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          auto_approve_reason?: string | null
          auto_approved?: boolean
          created_at?: string
          currency?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          event_id?: string
          id?: string
          metadata?: Json
          order_id?: string | null
          org_id?: string | null
          processed_at?: string | null
          reason?: string
          reason_code?: string | null
          requester_email?: string
          requester_user_id?: string
          status?: Database["public"]["Enums"]["refund_request_status_t"]
          stripe_failure_reason?: string | null
          stripe_refund_id?: string | null
          stripe_refund_status?: string | null
          ticket_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_revenue_summary"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "refund_requests_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "ticket_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_requester_user_id_fkey"
            columns: ["requester_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_requester_user_id_fkey"
            columns: ["requester_user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: true
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      service_status_snapshots: {
        Row: {
          error_pct: number | null
          id: string
          latency_ms: number | null
          message: string | null
          recorded_at: string
          service: string
          status: string
        }
        Insert: {
          error_pct?: number | null
          id?: string
          latency_ms?: number | null
          message?: string | null
          recorded_at?: string
          service: string
          status: string
        }
        Update: {
          error_pct?: number | null
          id?: string
          latency_ms?: number | null
          message?: string | null
          recorded_at?: string
          service?: string
          status?: string
        }
        Relationships: []
      }
      stripe_payouts: {
        Row: {
          amount_cents: number
          arrival_date: string | null
          created_at: string
          currency: string
          destination_kind: string | null
          destination_last4: string | null
          failure_code: string | null
          failure_message: string | null
          id: string
          metadata: Json
          method: string | null
          org_id: string | null
          paid_at: string | null
          status: Database["public"]["Enums"]["stripe_payout_status_t"]
          stripe_account_id: string
          stripe_payout_id: string
        }
        Insert: {
          amount_cents: number
          arrival_date?: string | null
          created_at?: string
          currency?: string
          destination_kind?: string | null
          destination_last4?: string | null
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          metadata?: Json
          method?: string | null
          org_id?: string | null
          paid_at?: string | null
          status?: Database["public"]["Enums"]["stripe_payout_status_t"]
          stripe_account_id: string
          stripe_payout_id: string
        }
        Update: {
          amount_cents?: number
          arrival_date?: string | null
          created_at?: string
          currency?: string
          destination_kind?: string | null
          destination_last4?: string | null
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          metadata?: Json
          method?: string | null
          org_id?: string | null
          paid_at?: string | null
          status?: Database["public"]["Enums"]["stripe_payout_status_t"]
          stripe_account_id?: string
          stripe_payout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_payouts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          attempt_count: number
          event_id: string
          event_type: string
          id: string
          last_error: string | null
          livemode: boolean
          payload: Json
          processed_at: string | null
          received_at: string
          status: string
        }
        Insert: {
          attempt_count?: number
          event_id: string
          event_type: string
          id?: string
          last_error?: string | null
          livemode?: boolean
          payload: Json
          processed_at?: string | null
          received_at?: string
          status?: string
        }
        Update: {
          attempt_count?: number
          event_id?: string
          event_type?: string
          id?: string
          last_error?: string | null
          livemode?: boolean
          payload?: Json
          processed_at?: string | null
          received_at?: string
          status?: string
        }
        Relationships: []
      }
      subscription_plans: {
        Row: {
          ai_capabilities_included: string[]
          code: string
          created_at: string
          currency: string
          description: string | null
          features: Json
          id: string
          max_events_per_month: number | null
          max_team_members: number | null
          max_venues: number | null
          monthly_price_cents: number
          name: string
          sort_order: number
          status: string
          stripe_price_id_monthly: string | null
          stripe_price_id_yearly: string | null
          tagline: string | null
          trial_days: number
          updated_at: string
          visible_public: boolean
          yearly_price_cents: number
        }
        Insert: {
          ai_capabilities_included?: string[]
          code: string
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          id?: string
          max_events_per_month?: number | null
          max_team_members?: number | null
          max_venues?: number | null
          monthly_price_cents?: number
          name: string
          sort_order?: number
          status?: string
          stripe_price_id_monthly?: string | null
          stripe_price_id_yearly?: string | null
          tagline?: string | null
          trial_days?: number
          updated_at?: string
          visible_public?: boolean
          yearly_price_cents?: number
        }
        Update: {
          ai_capabilities_included?: string[]
          code?: string
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          id?: string
          max_events_per_month?: number | null
          max_team_members?: number | null
          max_venues?: number | null
          monthly_price_cents?: number
          name?: string
          sort_order?: number
          status?: string
          stripe_price_id_monthly?: string | null
          stripe_price_id_yearly?: string | null
          tagline?: string | null
          trial_days?: number
          updated_at?: string
          visible_public?: boolean
          yearly_price_cents?: number
        }
        Relationships: []
      }
      support_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          id: string
          message_id: string
          mime_type: string | null
          size_bytes: number | null
          virus_scan_result: string | null
          virus_scanned: boolean
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          id?: string
          message_id: string
          mime_type?: string | null
          size_bytes?: number | null
          virus_scan_result?: string | null
          virus_scanned?: boolean
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          id?: string
          message_id?: string
          mime_type?: string | null
          size_bytes?: number | null
          virus_scan_result?: string | null
          virus_scanned?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "support_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "support_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      support_canned_replies: {
        Row: {
          active: boolean
          body: string
          created_at: string
          id: string
          org_id: string | null
          owner_role: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          body: string
          created_at?: string
          id?: string
          org_id?: string | null
          owner_role: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          body?: string
          created_at?: string
          id?: string
          org_id?: string | null
          owner_role?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_canned_replies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      support_conversations: {
        Row: {
          assigned_admin_id: string | null
          client_id: string
          created_at: string
          event_id: string | null
          id: string
          kind: Database["public"]["Enums"]["support_kind_t"]
          last_message_at: string | null
          last_message_preview: string | null
          org_id: string | null
          partner_id: string | null
          status: string
          subject: string | null
          unread_for_admin: number
          unread_for_client: number
        }
        Insert: {
          assigned_admin_id?: string | null
          client_id: string
          created_at?: string
          event_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["support_kind_t"]
          last_message_at?: string | null
          last_message_preview?: string | null
          org_id?: string | null
          partner_id?: string | null
          status?: string
          subject?: string | null
          unread_for_admin?: number
          unread_for_client?: number
        }
        Update: {
          assigned_admin_id?: string | null
          client_id?: string
          created_at?: string
          event_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["support_kind_t"]
          last_message_at?: string | null
          last_message_preview?: string | null
          org_id?: string | null
          partner_id?: string | null
          status?: string
          subject?: string | null
          unread_for_admin?: number
          unread_for_client?: number
        }
        Relationships: [
          {
            foreignKeyName: "support_conversations_assigned_admin_id_fkey"
            columns: ["assigned_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_conversations_assigned_admin_id_fkey"
            columns: ["assigned_admin_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_conversations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_conversations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_conversations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_conversations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_revenue_summary"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "support_conversations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_conversations_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_conversations_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
          sender_kind: Database["public"]["Enums"]["support_sender_t"]
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id: string
          sender_kind: Database["public"]["Enums"]["support_sender_t"]
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
          sender_kind?: Database["public"]["Enums"]["support_sender_t"]
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "support_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_filings: {
        Row: {
          agency_reference: string | null
          amount_due_cents: number | null
          amount_paid_cents: number | null
          country: string
          created_at: string
          filed_at: string | null
          filed_by: string | null
          id: string
          kind: Database["public"]["Enums"]["tax_filing_kind_t"]
          notes: string | null
          org_id: string
          payload_path: string | null
          period: string
          status: Database["public"]["Enums"]["tax_filing_status_t"]
          updated_at: string
        }
        Insert: {
          agency_reference?: string | null
          amount_due_cents?: number | null
          amount_paid_cents?: number | null
          country?: string
          created_at?: string
          filed_at?: string | null
          filed_by?: string | null
          id?: string
          kind: Database["public"]["Enums"]["tax_filing_kind_t"]
          notes?: string | null
          org_id: string
          payload_path?: string | null
          period: string
          status?: Database["public"]["Enums"]["tax_filing_status_t"]
          updated_at?: string
        }
        Update: {
          agency_reference?: string | null
          amount_due_cents?: number | null
          amount_paid_cents?: number | null
          country?: string
          created_at?: string
          filed_at?: string | null
          filed_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["tax_filing_kind_t"]
          notes?: string | null
          org_id?: string
          payload_path?: string | null
          period?: string
          status?: Database["public"]["Enums"]["tax_filing_status_t"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_filings_filed_by_fkey"
            columns: ["filed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_filings_filed_by_fkey"
            columns: ["filed_by"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_filings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_orders: {
        Row: {
          buyer_email: string
          buyer_first_name: string | null
          buyer_last_name: string | null
          buyer_phone: string | null
          buyer_user_id: string | null
          created_at: string
          currency: string
          event_id: string
          expires_at: string | null
          fees_cents: number
          id: string
          metadata: Json
          org_id: string | null
          paid_at: string | null
          refunded_at: string | null
          request_id: string
          status: Database["public"]["Enums"]["ticket_order_status_t"]
          stripe_destination_account: string | null
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          subtotal_cents: number
          total_cents: number
        }
        Insert: {
          buyer_email: string
          buyer_first_name?: string | null
          buyer_last_name?: string | null
          buyer_phone?: string | null
          buyer_user_id?: string | null
          created_at?: string
          currency?: string
          event_id: string
          expires_at?: string | null
          fees_cents?: number
          id?: string
          metadata?: Json
          org_id?: string | null
          paid_at?: string | null
          refunded_at?: string | null
          request_id?: string
          status?: Database["public"]["Enums"]["ticket_order_status_t"]
          stripe_destination_account?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          subtotal_cents?: number
          total_cents?: number
        }
        Update: {
          buyer_email?: string
          buyer_first_name?: string | null
          buyer_last_name?: string | null
          buyer_phone?: string | null
          buyer_user_id?: string | null
          created_at?: string
          currency?: string
          event_id?: string
          expires_at?: string | null
          fees_cents?: number
          id?: string
          metadata?: Json
          org_id?: string | null
          paid_at?: string | null
          refunded_at?: string | null
          request_id?: string
          status?: Database["public"]["Enums"]["ticket_order_status_t"]
          stripe_destination_account?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          subtotal_cents?: number
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "ticket_orders_buyer_user_id_fkey"
            columns: ["buyer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_orders_buyer_user_id_fkey"
            columns: ["buyer_user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_orders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_orders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_revenue_summary"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "ticket_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_scan_logs: {
        Row: {
          device_info: string | null
          event_id: string | null
          id: string
          metadata: Json
          notes: string | null
          org_id: string | null
          qr_token_hash: string | null
          result: Database["public"]["Enums"]["scan_result_t"]
          scanned_at: string
          scanned_by_user_id: string | null
          ticket_id: string | null
          venue_id: string | null
        }
        Insert: {
          device_info?: string | null
          event_id?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          org_id?: string | null
          qr_token_hash?: string | null
          result: Database["public"]["Enums"]["scan_result_t"]
          scanned_at?: string
          scanned_by_user_id?: string | null
          ticket_id?: string | null
          venue_id?: string | null
        }
        Update: {
          device_info?: string | null
          event_id?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          org_id?: string | null
          qr_token_hash?: string | null
          result?: Database["public"]["Enums"]["scan_result_t"]
          scanned_at?: string
          scanned_by_user_id?: string | null
          ticket_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_scan_logs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_scan_logs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_revenue_summary"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "ticket_scan_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_scan_logs_scanned_by_user_id_fkey"
            columns: ["scanned_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_scan_logs_scanned_by_user_id_fkey"
            columns: ["scanned_by_user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_scan_logs_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_scan_logs_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_tiers: {
        Row: {
          capacity: number | null
          created_at: string
          currency: string
          description: string | null
          event_id: string
          id: string
          metadata: Json
          name: string
          per_user_max: number
          price_cents: number
          refundable_until_hours_before: number
          sale_ends_at: string | null
          sale_starts_at: string | null
          sold: number
          sort_order: number
          status: Database["public"]["Enums"]["ticket_tier_status_t"]
          stripe_price_id: string | null
          transfer_allowed: boolean
          updated_at: string
        }
        Insert: {
          capacity?: number | null
          created_at?: string
          currency?: string
          description?: string | null
          event_id: string
          id?: string
          metadata?: Json
          name: string
          per_user_max?: number
          price_cents: number
          refundable_until_hours_before?: number
          sale_ends_at?: string | null
          sale_starts_at?: string | null
          sold?: number
          sort_order?: number
          status?: Database["public"]["Enums"]["ticket_tier_status_t"]
          stripe_price_id?: string | null
          transfer_allowed?: boolean
          updated_at?: string
        }
        Update: {
          capacity?: number | null
          created_at?: string
          currency?: string
          description?: string | null
          event_id?: string
          id?: string
          metadata?: Json
          name?: string
          per_user_max?: number
          price_cents?: number
          refundable_until_hours_before?: number
          sale_ends_at?: string | null
          sale_starts_at?: string | null
          sold?: number
          sort_order?: number
          status?: Database["public"]["Enums"]["ticket_tier_status_t"]
          stripe_price_id?: string | null
          transfer_allowed?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_tiers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_tiers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_revenue_summary"
            referencedColumns: ["event_id"]
          },
        ]
      }
      ticket_transfers: {
        Row: {
          created_at: string
          expires_at: string
          from_user_id: string | null
          id: string
          invitation_token: string
          message: string | null
          responded_at: string | null
          status: Database["public"]["Enums"]["ticket_transfer_status_t"]
          ticket_id: string
          to_email: string
          to_user_id: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          from_user_id?: string | null
          id?: string
          invitation_token?: string
          message?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["ticket_transfer_status_t"]
          ticket_id: string
          to_email: string
          to_user_id?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          from_user_id?: string | null
          id?: string
          invitation_token?: string
          message?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["ticket_transfer_status_t"]
          ticket_id?: string
          to_email?: string
          to_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_transfers_from_user_id_fkey"
            columns: ["from_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_transfers_from_user_id_fkey"
            columns: ["from_user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_transfers_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_transfers_to_user_id_fkey"
            columns: ["to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_transfers_to_user_id_fkey"
            columns: ["to_user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          access_url_token: string | null
          amount_paid_cents: number
          buyer_email: string
          buyer_first_name: string | null
          buyer_last_name: string | null
          buyer_phone: string | null
          buyer_user_id: string | null
          created_at: string
          currency: string
          event_id: string
          holder_email: string | null
          holder_first_name: string | null
          holder_last_name: string | null
          id: string
          order_id: string | null
          paid_at: string | null
          qr_token: string
          status: Database["public"]["Enums"]["ticket_status_t"]
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          tier_id: string | null
          transferred_at: string | null
          transferred_to_user_id: string | null
          used_at: string | null
          used_by_partner_id: string | null
        }
        Insert: {
          access_url_token?: string | null
          amount_paid_cents?: number
          buyer_email: string
          buyer_first_name?: string | null
          buyer_last_name?: string | null
          buyer_phone?: string | null
          buyer_user_id?: string | null
          created_at?: string
          currency?: string
          event_id: string
          holder_email?: string | null
          holder_first_name?: string | null
          holder_last_name?: string | null
          id?: string
          order_id?: string | null
          paid_at?: string | null
          qr_token?: string
          status?: Database["public"]["Enums"]["ticket_status_t"]
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          tier_id?: string | null
          transferred_at?: string | null
          transferred_to_user_id?: string | null
          used_at?: string | null
          used_by_partner_id?: string | null
        }
        Update: {
          access_url_token?: string | null
          amount_paid_cents?: number
          buyer_email?: string
          buyer_first_name?: string | null
          buyer_last_name?: string | null
          buyer_phone?: string | null
          buyer_user_id?: string | null
          created_at?: string
          currency?: string
          event_id?: string
          holder_email?: string | null
          holder_first_name?: string | null
          holder_last_name?: string | null
          id?: string
          order_id?: string | null
          paid_at?: string | null
          qr_token?: string
          status?: Database["public"]["Enums"]["ticket_status_t"]
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          tier_id?: string | null
          transferred_at?: string | null
          transferred_to_user_id?: string | null
          used_at?: string | null
          used_by_partner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_buyer_user_id_fkey"
            columns: ["buyer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_buyer_user_id_fkey"
            columns: ["buyer_user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_revenue_summary"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "ticket_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "ticket_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_transferred_to_user_id_fkey"
            columns: ["transferred_to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_transferred_to_user_id_fkey"
            columns: ["transferred_to_user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_used_by_partner_id_fkey"
            columns: ["used_by_partner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_used_by_partner_id_fkey"
            columns: ["used_by_partner_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      user_2fa: {
        Row: {
          backup_codes_hashed: string[]
          created_at: string
          disabled_at: string | null
          enabled: boolean
          enabled_at: string | null
          last_used_at: string | null
          method: Database["public"]["Enums"]["user_2fa_method_t"]
          phone: string | null
          totp_secret_encrypted: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          backup_codes_hashed?: string[]
          created_at?: string
          disabled_at?: string | null
          enabled?: boolean
          enabled_at?: string | null
          last_used_at?: string | null
          method?: Database["public"]["Enums"]["user_2fa_method_t"]
          phone?: string | null
          totp_secret_encrypted?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          backup_codes_hashed?: string[]
          created_at?: string
          disabled_at?: string | null
          enabled?: boolean
          enabled_at?: string | null
          last_used_at?: string | null
          method?: Database["public"]["Enums"]["user_2fa_method_t"]
          phone?: string | null
          totp_secret_encrypted?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_2fa_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_2fa_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
          reason: string | null
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
          reason?: string | null
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      user_fcm_tokens: {
        Row: {
          created_at: string
          fcm_token: string
          id: string
          platform: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          fcm_token: string
          id?: string
          platform: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          fcm_token?: string
          id?: string
          platform?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_fcm_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_fcm_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      user_notification_prefs: {
        Row: {
          category: string
          channel: Database["public"]["Enums"]["notification_channel_t"]
          enabled: boolean
          id: string
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          channel: Database["public"]["Enums"]["notification_channel_t"]
          enabled?: boolean
          id?: string
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          channel?: Database["public"]["Enums"]["notification_channel_t"]
          enabled?: boolean
          id?: string
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notification_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_notification_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      venues: {
        Row: {
          address: string | null
          brand_id: string
          business_category: string | null
          capacity: number | null
          city: string
          country: string
          cover_image_url: string | null
          created_at: string
          description: string | null
          email: string | null
          id: string
          latitude: number | null
          longitude: number | null
          metadata: Json
          name: string
          opening_hours: Json
          org_id: string
          phone: string | null
          postal_code: string | null
          slug: string
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          brand_id: string
          business_category?: string | null
          capacity?: number | null
          city: string
          country?: string
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          email?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          metadata?: Json
          name: string
          opening_hours?: Json
          org_id: string
          phone?: string | null
          postal_code?: string | null
          slug: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          brand_id?: string
          business_category?: string | null
          capacity?: number | null
          city?: string
          country?: string
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          email?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          metadata?: Json
          name?: string
          opening_hours?: Json
          org_id?: string
          phone?: string | null
          postal_code?: string | null
          slug?: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "venues_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venues_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vip_areas: {
        Row: {
          active: boolean
          capacity: number
          created_at: string
          description: string | null
          id: string
          min_spend_cents: number
          name: string
          photo_url: string | null
          sort_order: number
          updated_at: string
          venue_id: string
        }
        Insert: {
          active?: boolean
          capacity: number
          created_at?: string
          description?: string | null
          id?: string
          min_spend_cents?: number
          name: string
          photo_url?: string | null
          sort_order?: number
          updated_at?: string
          venue_id: string
        }
        Update: {
          active?: boolean
          capacity?: number
          created_at?: string
          description?: string | null
          id?: string
          min_spend_cents?: number
          name?: string
          photo_url?: string | null
          sort_order?: number
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vip_areas_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      vip_bookings: {
        Row: {
          cancelled_at: string | null
          confirmed_at: string | null
          created_at: string
          deposit_cents: number
          event_id: string
          holder_email: string | null
          holder_name: string
          holder_phone: string | null
          holder_user_id: string | null
          id: string
          min_spend_paid_cents: number
          notes: string | null
          party_size: number
          rrpp_user_id: string | null
          seated_at: string | null
          status: Database["public"]["Enums"]["vip_booking_status_t"]
          updated_at: string
          venue_id: string | null
          vip_area_id: string
        }
        Insert: {
          cancelled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          deposit_cents?: number
          event_id: string
          holder_email?: string | null
          holder_name: string
          holder_phone?: string | null
          holder_user_id?: string | null
          id?: string
          min_spend_paid_cents?: number
          notes?: string | null
          party_size: number
          rrpp_user_id?: string | null
          seated_at?: string | null
          status?: Database["public"]["Enums"]["vip_booking_status_t"]
          updated_at?: string
          venue_id?: string | null
          vip_area_id: string
        }
        Update: {
          cancelled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          deposit_cents?: number
          event_id?: string
          holder_email?: string | null
          holder_name?: string
          holder_phone?: string | null
          holder_user_id?: string | null
          id?: string
          min_spend_paid_cents?: number
          notes?: string | null
          party_size?: number
          rrpp_user_id?: string | null
          seated_at?: string | null
          status?: Database["public"]["Enums"]["vip_booking_status_t"]
          updated_at?: string
          venue_id?: string | null
          vip_area_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vip_bookings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_bookings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_revenue_summary"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "vip_bookings_holder_user_id_fkey"
            columns: ["holder_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_bookings_holder_user_id_fkey"
            columns: ["holder_user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_bookings_rrpp_user_id_fkey"
            columns: ["rrpp_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_bookings_rrpp_user_id_fkey"
            columns: ["rrpp_user_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_bookings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vip_bookings_vip_area_id_fkey"
            columns: ["vip_area_id"]
            isOneToOne: false
            referencedRelation: "vip_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      whitelabel_configs: {
        Row: {
          accent_color: string | null
          app_name_override: string | null
          bg_color: string | null
          cookies_url: string | null
          custom_css: string | null
          custom_domain: string | null
          custom_head_html: string | null
          email_reply_to: string | null
          email_sender_email: string | null
          email_sender_name: string | null
          favicon_url: string | null
          go_live_at: string | null
          ink_color: string | null
          legal_address: string | null
          legal_company_name: string | null
          legal_vat_id: string | null
          logo_dark_url: string | null
          logo_url: string | null
          mobile_app_bundle_id: string | null
          mobile_app_enabled: boolean
          mobile_app_scheme: string | null
          org_id: string
          primary_color: string | null
          privacy_url: string | null
          social_links: Json
          status: string
          subdomain: string | null
          support_email: string | null
          support_phone: string | null
          terms_url: string | null
          updated_at: string
        }
        Insert: {
          accent_color?: string | null
          app_name_override?: string | null
          bg_color?: string | null
          cookies_url?: string | null
          custom_css?: string | null
          custom_domain?: string | null
          custom_head_html?: string | null
          email_reply_to?: string | null
          email_sender_email?: string | null
          email_sender_name?: string | null
          favicon_url?: string | null
          go_live_at?: string | null
          ink_color?: string | null
          legal_address?: string | null
          legal_company_name?: string | null
          legal_vat_id?: string | null
          logo_dark_url?: string | null
          logo_url?: string | null
          mobile_app_bundle_id?: string | null
          mobile_app_enabled?: boolean
          mobile_app_scheme?: string | null
          org_id: string
          primary_color?: string | null
          privacy_url?: string | null
          social_links?: Json
          status?: string
          subdomain?: string | null
          support_email?: string | null
          support_phone?: string | null
          terms_url?: string | null
          updated_at?: string
        }
        Update: {
          accent_color?: string | null
          app_name_override?: string | null
          bg_color?: string | null
          cookies_url?: string | null
          custom_css?: string | null
          custom_domain?: string | null
          custom_head_html?: string | null
          email_reply_to?: string | null
          email_sender_email?: string | null
          email_sender_name?: string | null
          favicon_url?: string | null
          go_live_at?: string | null
          ink_color?: string | null
          legal_address?: string | null
          legal_company_name?: string | null
          legal_vat_id?: string | null
          logo_dark_url?: string | null
          logo_url?: string | null
          mobile_app_bundle_id?: string | null
          mobile_app_enabled?: boolean
          mobile_app_scheme?: string | null
          org_id?: string
          primary_color?: string | null
          privacy_url?: string | null
          social_links?: Json
          status?: string
          subdomain?: string | null
          support_email?: string | null
          support_phone?: string | null
          terms_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whitelabel_configs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      public_partners: {
        Row: {
          avatar_url: string | null
          business_category: string | null
          business_description: string | null
          business_name: string | null
          city: string | null
          cover_image_url: string | null
          id: string | null
        }
        Insert: {
          avatar_url?: string | null
          business_category?: string | null
          business_description?: string | null
          business_name?: string | null
          city?: string | null
          cover_image_url?: string | null
          id?: string | null
        }
        Update: {
          avatar_url?: string | null
          business_category?: string | null
          business_description?: string | null
          business_name?: string | null
          city?: string | null
          cover_image_url?: string | null
          id?: string | null
        }
        Relationships: []
      }
      v_admin_platform_kpis: {
        Row: {
          active_orgs: number | null
          active_subscriptions: number | null
          active_venues: number | null
          clients: number | null
          partners: number | null
          pending_refunds: number | null
          platform_revenue_30d_cents: number | null
          published_events: number | null
          tickets_paid_lifetime: number | null
          tickets_used_lifetime: number | null
          total_users: number | null
        }
        Relationships: []
      }
      v_event_revenue_summary: {
        Row: {
          capacity: number | null
          city: string | null
          date_start: string | null
          event_id: string | null
          fees_cents: number | null
          gross_revenue_cents: number | null
          net_revenue_cents: number | null
          org_id: string | null
          paid_orders: number | null
          partner_id: string | null
          pending_refunds: number | null
          refunded_orders: number | null
          status: Database["public"]["Enums"]["event_status_t"] | null
          tickets_sold: number | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "public_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      v_partner_kpis_daily: {
        Row: {
          day: string | null
          gross_cents: number | null
          net_cents: number | null
          orders_paid: number | null
          org_id: string | null
          platform_fees_cents: number | null
          tickets_paid: number | null
          tickets_used: number | null
        }
        Relationships: [
          {
            foreignKeyName: "events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_invitation: { Args: { _token: string }; Returns: string }
      accept_ticket_transfer: { Args: { _token: string }; Returns: string }
      admin_grant_partner_access: {
        Args: { _user_id: string }
        Returns: undefined
      }
      admin_grant_partner_access_until: {
        Args: { _note?: string; _org_id: string; _until: string }
        Returns: string
      }
      admin_list_users: {
        Args: {
          _limit?: number
          _offset?: number
          _role_filter?: string
          _search?: string
          _status_filter?: string
        }
        Returns: {
          account_status: string
          business_name: string
          city: string
          country: string
          created_at: string
          email: string
          first_name: string
          id: string
          last_name: string
          role: string
        }[]
      }
      admin_metrics_timeseries: {
        Args: { _days?: number }
        Returns: {
          day: string
          gross_cents: number
          platform_fees_cents: number
          signups: number
          tickets_sold: number
        }[]
      }
      admin_revoke_partner_access: {
        Args: { _user_id: string }
        Returns: undefined
      }
      admin_revoke_partner_grant: {
        Args: { _org_id: string }
        Returns: undefined
      }
      admin_subscription_funnel: {
        Args: never
        Returns: {
          count: number
          mrr_cents: number
          status: string
        }[]
      }
      admin_top_events: {
        Args: { _days?: number; _limit?: number }
        Returns: {
          business_name: string
          city: string
          date_start: string
          event_id: string
          gross_revenue_cents: number
          partner_id: string
          tickets_sold: number
          title: string
        }[]
      }
      assign_admin_to_conversation: {
        Args: { _admin_id: string; _conv_id: string }
        Returns: undefined
      }
      auto_approve_if_allowed: { Args: { _role: string }; Returns: boolean }
      cashless_pay: {
        Args: {
          _amount_cents: number
          _bar_id?: string
          _items?: Json
          _wallet_id: string
        }
        Returns: number
      }
      cashless_topup: {
        Args: {
          _amount_cents: number
          _source: Database["public"]["Enums"]["cashless_topup_source_t"]
          _stripe_pi?: string
          _wallet_id: string
        }
        Returns: number
      }
      check_rate_limit: {
        Args: { _key: string; _max: number; _window_sec: number }
        Returns: boolean
      }
      claim_initial_role: {
        Args: { _role: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      claim_partner_free_plan: {
        Args: never
        Returns: {
          out_org_id: string
          out_plan_code: string
          out_status: string
          out_subscription_id: string
        }[]
      }
      complete_partner_onboarding: {
        Args: { _data?: Json; _org_id?: string; _venue_id?: string }
        Returns: {
          completed_at: string | null
          created_at: string
          current_step: string | null
          data: Json
          id: string
          org_id: string | null
          status: string
          updated_at: string
          user_id: string
          venue_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "partner_onboarding_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_organization: {
        Args: { _country?: string; _name: string; _slug?: string }
        Returns: string
      }
      cron_cleanup_logs: { Args: never; Returns: undefined }
      cron_cleanup_old_notifications: { Args: never; Returns: number }
      cron_cleanup_rate_limits: { Args: never; Returns: number }
      cron_close_event_wallets: { Args: never; Returns: number }
      cron_expire_pending_orders: { Args: never; Returns: number }
      cron_expire_ticket_transfers: { Args: never; Returns: number }
      cron_mark_past_events: { Args: never; Returns: number }
      cron_process_dsar_deadlines: { Args: never; Returns: number }
      decide_ai_decision: {
        Args: { _decision: string; _decision_id: string; _note?: string }
        Returns: undefined
      }
      decide_refund: {
        Args: { _decision: string; _note?: string; _request_id: string }
        Returns: undefined
      }
      door_scan: {
        Args: { _qr_token: string }
        Returns: {
          event_id: string
          holder_first_name: string
          holder_last_name: string
          reason: string
          result: Database["public"]["Enums"]["door_scan_result_t"]
          ticket_id: string
          tier_name: string
        }[]
      }
      enqueue_notification: {
        Args: {
          _body?: string
          _category: string
          _kind: string
          _link?: string
          _payload?: Json
          _priority?: string
          _title: string
          _user_id: string
        }
        Returns: string
      }
      event_has_sales: { Args: { _event_id: string }; Returns: boolean }
      get_app_setting_bool: { Args: { _key: string }; Returns: boolean }
      get_app_setting_int: { Args: { _key: string }; Returns: number }
      get_app_setting_text: { Args: { _key: string }; Returns: string }
      get_feature_flag: {
        Args: { _code: string; _org_id?: string }
        Returns: boolean
      }
      get_user_role: { Args: { _user_id: string }; Returns: string }
      get_user_roles: { Args: { _user_id: string }; Returns: string[] }
      global_search: {
        Args: { _limit?: number; _q: string }
        Returns: {
          id: string
          kind: string
          link: string
          subtitle: string
          title: string
        }[]
      }
      has_org_role: {
        Args: {
          _org_id: string
          _roles: Database["public"]["Enums"]["org_member_role_t"][]
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      invite_member: {
        Args: {
          _brand_id?: string
          _email: string
          _org_id: string
          _role: Database["public"]["Enums"]["org_member_role_t"]
          _venue_id?: string
        }
        Returns: string
      }
      is_member_of_org: { Args: { _org_id: string }; Returns: boolean }
      is_member_of_venue: { Args: { _venue_id: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin_self: { Args: never; Returns: boolean }
      loyalty_balance: { Args: { _user_id: string }; Returns: number }
      loyalty_grant_points: {
        Args: {
          _amount: number
          _event_id?: string
          _expires_at?: string
          _org_id?: string
          _reason: string
          _reason_code?: string
          _ticket_id?: string
          _user_id: string
        }
        Returns: number
      }
      mark_conversation_read: {
        Args: { _as_kind: string; _conversation_id: string }
        Returns: undefined
      }
      mark_order_paid: {
        Args: {
          _amount_total_cents: number
          _application_fee_cents?: number
          _payment_intent_id: string
          _session_id: string
        }
        Returns: string
      }
      mark_refund_processed: {
        Args: {
          _amount_refunded_cents: number
          _payment_intent_id: string
          _stripe_refund_id: string
        }
        Returns: string
      }
      mark_ticket_used: {
        Args: { _qr_token: string }
        Returns: {
          already_used: boolean
          event_id: string
          event_title: string
          holder_first_name: string
          holder_last_name: string
          status: string
          ticket_id: string
          tier_name: string
        }[]
      }
      open_conversation: {
        Args: {
          _event_id?: string
          _kind: Database["public"]["Enums"]["support_kind_t"]
          _org_id?: string
          _partner_id?: string
          _subject?: string
        }
        Returns: string
      }
      partner_event_attendees: {
        Args: { _event_id: string }
        Returns: {
          amount_paid_cents: number
          buyer_email: string
          buyer_first_name: string
          buyer_last_name: string
          buyer_phone: string
          currency: string
          order_id: string
          paid_at: string
          qr_token: string
          scanned_by_name: string
          status: string
          ticket_id: string
          tier_name: string
          used_at: string
          used_by_partner_id: string
        }[]
      }
      partner_event_checkin_stats: {
        Args: { _event_id: string }
        Returns: {
          capacity: number
          checkin_pct: number
          revenue_cents: number
          tickets_pending: number
          tickets_refunded: number
          tickets_sold: number
          tickets_used: number
        }[]
      }
      partner_event_tier_live_stats: {
        Args: { _event_id: string }
        Returns: {
          capacity: number
          checkin_pct: number
          has_sales: boolean
          pending_count: number
          refunded_count: number
          revenue_cents: number
          sold_count: number
          sort_order: number
          tier_id: string
          tier_name: string
          tier_status: string
          used_count: number
        }[]
      }
      partner_onboarding_status: {
        Args: never
        Returns: {
          completed_at: string
          has_event: boolean
          has_org: boolean
          has_venue: boolean
          onboarding_status: string
          primary_org_id: string
          primary_venue_id: string
          should_show_wizard: boolean
          user_id: string
        }[]
      }
      request_refund: {
        Args: { _reason: string; _reason_code?: string; _ticket_id: string }
        Returns: string
      }
      resolve_whitelabel_host: {
        Args: { _host: string }
        Returns: {
          accent_color: string
          app_name_override: string
          custom_domain: string
          logo_url: string
          org_id: string
          primary_color: string
          subdomain: string
          support_email: string
        }[]
      }
      save_partner_onboarding_progress: {
        Args: { _data?: Json; _org_id?: string; _step?: string }
        Returns: {
          completed_at: string | null
          created_at: string
          current_step: string | null
          data: Json
          id: string
          org_id: string | null
          status: string
          updated_at: string
          user_id: string
          venue_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "partner_onboarding_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      scan_ticket: {
        Args: { _device_info?: string; _qr_token: string }
        Returns: {
          already_used_at: string
          buyer_email: string
          buyer_first_name: string
          buyer_last_name: string
          event_id: string
          event_title: string
          result: Database["public"]["Enums"]["scan_result_t"]
          scanned_at: string
          success: boolean
          ticket_id: string
          tier_name: string
        }[]
      }
      set_admin_by_email: { Args: { _email: string }; Returns: string }
      set_app_setting: {
        Args: { _key: string; _value: Json }
        Returns: undefined
      }
      start_partner_trial: {
        Args: { _org_id?: string }
        Returns: {
          current_period_end: string
          current_period_start: string
          org_id: string
          plan_code: string
          plan_id: string
          status: string
          subscription_id: string
          trial_ends_at: string
          trial_starts_at: string
        }[]
      }
      switch_active_venue: { Args: { _venue_id: string }; Returns: undefined }
      tenant_for_user: {
        Args: never
        Returns: {
          brand_id: string
          brand_name: string
          org_id: string
          org_name: string
          role: Database["public"]["Enums"]["org_member_role_t"]
          venue_id: string
          venue_name: string
        }[]
      }
      tier_has_sales: { Args: { _tier_id: string }; Returns: boolean }
      toggle_ai_kill_switch: {
        Args: { _capability: string; _reason?: string }
        Returns: boolean
      }
      transfer_ticket: {
        Args: { _message?: string; _ticket_id: string; _to_email: string }
        Returns: string
      }
    }
    Enums: {
      account_status_t: "pending" | "approved" | "rejected"
      ai_anomaly_severity_t: "low" | "medium" | "high" | "critical"
      ai_audit_result_t: "ok" | "blocked" | "escalated" | "failed" | "dry_run"
      ai_capability_status_t:
        | "active"
        | "paused"
        | "killed"
        | "beta"
        | "deprecated"
      ai_decision_status_t:
        | "proposed"
        | "approved"
        | "rejected"
        | "expired"
        | "executed"
        | "failed"
      app_role: "admin" | "partner" | "client"
      cashless_topup_source_t:
        | "card"
        | "cash"
        | "gift"
        | "transfer"
        | "wristband_recharge"
      cashless_tx_kind_t:
        | "purchase"
        | "refund"
        | "tip"
        | "transfer_in"
        | "transfer_out"
      cashless_wallet_status_t: "active" | "closed" | "refunded"
      door_scan_result_t:
        | "ok"
        | "already_used"
        | "expired"
        | "invalid"
        | "underage"
        | "blacklisted"
        | "denied"
        | "transferred"
      door_vision_kind_t:
        | "match"
        | "mismatch"
        | "underage"
        | "blacklist"
        | "density_alert"
        | "intoxication"
        | "dress_code"
      dsar_status_t:
        | "pending"
        | "in_progress"
        | "completed"
        | "rejected"
        | "cancelled"
      dsar_type_t:
        | "export"
        | "deletion"
        | "rectification"
        | "restriction"
        | "objection"
        | "portability"
      event_status_t: "draft" | "published" | "cancelled" | "past"
      installed_app_status_t:
        | "connected"
        | "disconnected"
        | "error"
        | "syncing"
        | "pending_auth"
      marketing_campaign_status_t:
        | "draft"
        | "scheduled"
        | "running"
        | "paused"
        | "completed"
        | "cancelled"
        | "failed"
      marketing_channel_t:
        | "email"
        | "sms"
        | "push"
        | "in_app"
        | "meta_ads"
        | "tiktok_ads"
        | "google_ads"
        | "whatsapp"
      marketplace_app_status_t:
        | "available"
        | "beta"
        | "deprecated"
        | "coming_soon"
      notification_channel_t: "push" | "email" | "sms" | "in_app"
      notification_status_t:
        | "pending"
        | "sent"
        | "failed"
        | "skipped"
        | "delivered"
        | "read"
      org_member_role_t:
        | "owner"
        | "admin"
        | "manager"
        | "rrpp"
        | "door_staff"
        | "pos_staff"
        | "read_only"
      partner_subscription_status_t:
        | "trialing"
        | "active"
        | "past_due"
        | "unpaid"
        | "cancel_at_period_end"
        | "cancelled"
        | "paused"
        | "incomplete"
        | "incomplete_expired"
      pos_payment_method_t:
        | "card"
        | "cash"
        | "wristband"
        | "complimentary"
        | "other"
      refund_request_sender_t: "client" | "partner" | "admin" | "system"
      refund_request_status_t:
        | "pending"
        | "approved"
        | "rejected"
        | "processing"
        | "refunded"
        | "failed"
      scan_result_t:
        | "success"
        | "already_used"
        | "invalid_ticket"
        | "wrong_event"
        | "not_paid"
        | "forbidden"
      stripe_payout_status_t:
        | "pending"
        | "in_transit"
        | "paid"
        | "failed"
        | "cancelled"
      support_kind_t: "client_admin" | "partner_admin" | "client_partner"
      support_sender_t: "client" | "admin" | "partner"
      tax_filing_kind_t:
        | "modelo_303"
        | "modelo_349"
        | "modelo_347"
        | "modelo_390"
        | "FR_CA12"
        | "FR_CA3"
        | "IT_LIPE"
        | "PT_IVA"
        | "UK_VAT"
      tax_filing_status_t:
        | "draft"
        | "submitted"
        | "accepted"
        | "rejected"
        | "amended"
      ticket_order_status_t:
        | "pending"
        | "paid"
        | "partial_refund"
        | "refunded"
        | "failed"
        | "expired"
      ticket_status_t: "pending" | "paid" | "used" | "refunded" | "cancelled"
      ticket_tier_status_t: "active" | "sold_out" | "closed" | "hidden"
      ticket_transfer_status_t:
        | "pending"
        | "accepted"
        | "declined"
        | "expired"
        | "cancelled"
      user_2fa_method_t: "totp" | "sms" | "email"
      vip_booking_status_t:
        | "requested"
        | "confirmed"
        | "seated"
        | "no_show"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      account_status_t: ["pending", "approved", "rejected"],
      ai_anomaly_severity_t: ["low", "medium", "high", "critical"],
      ai_audit_result_t: ["ok", "blocked", "escalated", "failed", "dry_run"],
      ai_capability_status_t: [
        "active",
        "paused",
        "killed",
        "beta",
        "deprecated",
      ],
      ai_decision_status_t: [
        "proposed",
        "approved",
        "rejected",
        "expired",
        "executed",
        "failed",
      ],
      app_role: ["admin", "partner", "client"],
      cashless_topup_source_t: [
        "card",
        "cash",
        "gift",
        "transfer",
        "wristband_recharge",
      ],
      cashless_tx_kind_t: [
        "purchase",
        "refund",
        "tip",
        "transfer_in",
        "transfer_out",
      ],
      cashless_wallet_status_t: ["active", "closed", "refunded"],
      door_scan_result_t: [
        "ok",
        "already_used",
        "expired",
        "invalid",
        "underage",
        "blacklisted",
        "denied",
        "transferred",
      ],
      door_vision_kind_t: [
        "match",
        "mismatch",
        "underage",
        "blacklist",
        "density_alert",
        "intoxication",
        "dress_code",
      ],
      dsar_status_t: [
        "pending",
        "in_progress",
        "completed",
        "rejected",
        "cancelled",
      ],
      dsar_type_t: [
        "export",
        "deletion",
        "rectification",
        "restriction",
        "objection",
        "portability",
      ],
      event_status_t: ["draft", "published", "cancelled", "past"],
      installed_app_status_t: [
        "connected",
        "disconnected",
        "error",
        "syncing",
        "pending_auth",
      ],
      marketing_campaign_status_t: [
        "draft",
        "scheduled",
        "running",
        "paused",
        "completed",
        "cancelled",
        "failed",
      ],
      marketing_channel_t: [
        "email",
        "sms",
        "push",
        "in_app",
        "meta_ads",
        "tiktok_ads",
        "google_ads",
        "whatsapp",
      ],
      marketplace_app_status_t: [
        "available",
        "beta",
        "deprecated",
        "coming_soon",
      ],
      notification_channel_t: ["push", "email", "sms", "in_app"],
      notification_status_t: [
        "pending",
        "sent",
        "failed",
        "skipped",
        "delivered",
        "read",
      ],
      org_member_role_t: [
        "owner",
        "admin",
        "manager",
        "rrpp",
        "door_staff",
        "pos_staff",
        "read_only",
      ],
      partner_subscription_status_t: [
        "trialing",
        "active",
        "past_due",
        "unpaid",
        "cancel_at_period_end",
        "cancelled",
        "paused",
        "incomplete",
        "incomplete_expired",
      ],
      pos_payment_method_t: [
        "card",
        "cash",
        "wristband",
        "complimentary",
        "other",
      ],
      refund_request_sender_t: ["client", "partner", "admin", "system"],
      refund_request_status_t: [
        "pending",
        "approved",
        "rejected",
        "processing",
        "refunded",
        "failed",
      ],
      scan_result_t: [
        "success",
        "already_used",
        "invalid_ticket",
        "wrong_event",
        "not_paid",
        "forbidden",
      ],
      stripe_payout_status_t: [
        "pending",
        "in_transit",
        "paid",
        "failed",
        "cancelled",
      ],
      support_kind_t: ["client_admin", "partner_admin", "client_partner"],
      support_sender_t: ["client", "admin", "partner"],
      tax_filing_kind_t: [
        "modelo_303",
        "modelo_349",
        "modelo_347",
        "modelo_390",
        "FR_CA12",
        "FR_CA3",
        "IT_LIPE",
        "PT_IVA",
        "UK_VAT",
      ],
      tax_filing_status_t: [
        "draft",
        "submitted",
        "accepted",
        "rejected",
        "amended",
      ],
      ticket_order_status_t: [
        "pending",
        "paid",
        "partial_refund",
        "refunded",
        "failed",
        "expired",
      ],
      ticket_status_t: ["pending", "paid", "used", "refunded", "cancelled"],
      ticket_tier_status_t: ["active", "sold_out", "closed", "hidden"],
      ticket_transfer_status_t: [
        "pending",
        "accepted",
        "declined",
        "expired",
        "cancelled",
      ],
      user_2fa_method_t: ["totp", "sms", "email"],
      vip_booking_status_t: [
        "requested",
        "confirmed",
        "seated",
        "no_show",
        "cancelled",
      ],
    },
  },
} as const
