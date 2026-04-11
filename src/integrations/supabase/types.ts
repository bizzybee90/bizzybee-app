export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '13.0.5';
  };
  public: {
    Tables: {
      ai_phone_knowledge_base: {
        Row: {
          agent_id: string;
          category: string | null;
          content: string;
          created_at: string | null;
          id: string;
          is_active: boolean | null;
          title: string;
          updated_at: string | null;
        };
        Insert: {
          agent_id: string;
          category?: string | null;
          content: string;
          created_at?: string | null;
          id?: string;
          is_active?: boolean | null;
          title: string;
          updated_at?: string | null;
        };
        Update: {
          agent_id?: string;
          category?: string | null;
          content?: string;
          created_at?: string | null;
          id?: string;
          is_active?: boolean | null;
          title?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_phone_knowledge_base_agent_id_fkey';
            columns: ['agent_id'];
            isOneToOne: false;
            referencedRelation: 'elevenlabs_agents';
            referencedColumns: ['id'];
          },
        ];
      };
      ai_phone_usage: {
        Row: {
          created_at: string | null;
          id: string;
          included_minutes: number | null;
          month: string;
          overage_cost_cents: number | null;
          overage_minutes: number | null;
          total_calls: number | null;
          total_cost_cents: number | null;
          total_minutes: number | null;
          updated_at: string | null;
          workspace_id: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          included_minutes?: number | null;
          month: string;
          overage_cost_cents?: number | null;
          overage_minutes?: number | null;
          total_calls?: number | null;
          total_cost_cents?: number | null;
          total_minutes?: number | null;
          updated_at?: string | null;
          workspace_id: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          included_minutes?: number | null;
          month?: string;
          overage_cost_cents?: number | null;
          overage_minutes?: number | null;
          total_calls?: number | null;
          total_cost_cents?: number | null;
          total_minutes?: number | null;
          updated_at?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_phone_usage_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      allowed_webhook_ips: {
        Row: {
          created_at: string | null;
          description: string | null;
          enabled: boolean | null;
          id: string;
          ip_address: string;
          workspace_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          description?: string | null;
          enabled?: boolean | null;
          id?: string;
          ip_address: string;
          workspace_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          description?: string | null;
          enabled?: boolean | null;
          id?: string;
          ip_address?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'allowed_webhook_ips_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      api_usage: {
        Row: {
          cache_creation_tokens: number | null;
          cache_read_tokens: number | null;
          cost_estimate: number | null;
          created_at: string | null;
          function_name: string | null;
          id: string;
          input_tokens: number | null;
          model: string | null;
          output_tokens: number | null;
          provider: string;
          request_metadata: Json;
          requests: number | null;
          task_type: string | null;
          tokens_used: number | null;
          workspace_id: string;
        };
        Insert: {
          cache_creation_tokens?: number | null;
          cache_read_tokens?: number | null;
          cost_estimate?: number | null;
          created_at?: string | null;
          function_name?: string | null;
          id?: string;
          input_tokens?: number | null;
          model?: string | null;
          output_tokens?: number | null;
          provider: string;
          request_metadata?: Json;
          requests?: number | null;
          task_type?: string | null;
          tokens_used?: number | null;
          workspace_id: string;
        };
        Update: {
          cache_creation_tokens?: number | null;
          cache_read_tokens?: number | null;
          cost_estimate?: number | null;
          created_at?: string | null;
          function_name?: string | null;
          id?: string;
          input_tokens?: number | null;
          model?: string | null;
          output_tokens?: number | null;
          provider?: string;
          request_metadata?: Json;
          requests?: number | null;
          task_type?: string | null;
          tokens_used?: number | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'api_usage_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      audio_transcripts: {
        Row: {
          created_at: string | null;
          created_conversation_id: string | null;
          duration_seconds: number | null;
          error_message: string | null;
          extracted_entities: Json | null;
          id: string;
          intent: string | null;
          matched_customer_id: string | null;
          processed_at: string | null;
          processing_status: string | null;
          received_at: string | null;
          sentiment: string | null;
          source_phone: string | null;
          source_type: string;
          source_url: string | null;
          summary: string | null;
          transcript: string | null;
          transcript_confidence: number | null;
          urgency: string | null;
          workspace_id: string;
        };
        Insert: {
          created_at?: string | null;
          created_conversation_id?: string | null;
          duration_seconds?: number | null;
          error_message?: string | null;
          extracted_entities?: Json | null;
          id?: string;
          intent?: string | null;
          matched_customer_id?: string | null;
          processed_at?: string | null;
          processing_status?: string | null;
          received_at?: string | null;
          sentiment?: string | null;
          source_phone?: string | null;
          source_type: string;
          source_url?: string | null;
          summary?: string | null;
          transcript?: string | null;
          transcript_confidence?: number | null;
          urgency?: string | null;
          workspace_id: string;
        };
        Update: {
          created_at?: string | null;
          created_conversation_id?: string | null;
          duration_seconds?: number | null;
          error_message?: string | null;
          extracted_entities?: Json | null;
          id?: string;
          intent?: string | null;
          matched_customer_id?: string | null;
          processed_at?: string | null;
          processing_status?: string | null;
          received_at?: string | null;
          sentiment?: string | null;
          source_phone?: string | null;
          source_type?: string;
          source_url?: string | null;
          summary?: string | null;
          transcript?: string | null;
          transcript_confidence?: number | null;
          urgency?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audio_transcripts_created_conversation_id_fkey';
            columns: ['created_conversation_id'];
            isOneToOne: false;
            referencedRelation: 'bb_needs_classification';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'audio_transcripts_created_conversation_id_fkey';
            columns: ['created_conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audio_transcripts_created_conversation_id_fkey';
            columns: ['created_conversation_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'audio_transcripts_matched_customer_id_fkey';
            columns: ['matched_customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audio_transcripts_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      automation_settings: {
        Row: {
          always_verify: boolean | null;
          auto_send_categories: string[] | null;
          auto_send_enabled: boolean | null;
          auto_send_exclude_new_customers: boolean | null;
          auto_send_threshold: number | null;
          channel_settings: Json | null;
          communication_model: string | null;
          competitor_model: string | null;
          created_at: string | null;
          default_to_drafts: boolean | null;
          email_model: string | null;
          enrichment_model: string | null;
          faq_model: string | null;
          id: string;
          low_confidence_threshold: number | null;
          notify_on_low_confidence: boolean | null;
          updated_at: string | null;
          verification_strictness: string | null;
          workspace_id: string;
        };
        Insert: {
          always_verify?: boolean | null;
          auto_send_categories?: string[] | null;
          auto_send_enabled?: boolean | null;
          auto_send_exclude_new_customers?: boolean | null;
          auto_send_threshold?: number | null;
          channel_settings?: Json | null;
          communication_model?: string | null;
          competitor_model?: string | null;
          created_at?: string | null;
          default_to_drafts?: boolean | null;
          email_model?: string | null;
          enrichment_model?: string | null;
          faq_model?: string | null;
          id?: string;
          low_confidence_threshold?: number | null;
          notify_on_low_confidence?: boolean | null;
          updated_at?: string | null;
          verification_strictness?: string | null;
          workspace_id: string;
        };
        Update: {
          always_verify?: boolean | null;
          auto_send_categories?: string[] | null;
          auto_send_enabled?: boolean | null;
          auto_send_exclude_new_customers?: boolean | null;
          auto_send_threshold?: number | null;
          channel_settings?: Json | null;
          communication_model?: string | null;
          competitor_model?: string | null;
          created_at?: string | null;
          default_to_drafts?: boolean | null;
          email_model?: string | null;
          enrichment_model?: string | null;
          faq_model?: string | null;
          id?: string;
          low_confidence_threshold?: number | null;
          notify_on_low_confidence?: boolean | null;
          updated_at?: string | null;
          verification_strictness?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'automation_settings_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: true;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      business_context: {
        Row: {
          active_insurance_claim: boolean | null;
          active_stripe_case: boolean | null;
          automation_level: string | null;
          business_type: string | null;
          company_logo_url: string | null;
          company_name: string | null;
          created_at: string | null;
          custom_flags: Json | null;
          email_domain: string | null;
          id: string;
          industry_faqs_copied: number | null;
          is_hiring: boolean | null;
          knowledge_base_completed_at: string | null;
          knowledge_base_started_at: string | null;
          knowledge_base_status: string | null;
          service_area: string | null;
          updated_at: string | null;
          website_faqs_generated: number | null;
          website_url: string | null;
          workspace_id: string | null;
        };
        Insert: {
          active_insurance_claim?: boolean | null;
          active_stripe_case?: boolean | null;
          automation_level?: string | null;
          business_type?: string | null;
          company_logo_url?: string | null;
          company_name?: string | null;
          created_at?: string | null;
          custom_flags?: Json | null;
          email_domain?: string | null;
          id?: string;
          industry_faqs_copied?: number | null;
          is_hiring?: boolean | null;
          knowledge_base_completed_at?: string | null;
          knowledge_base_started_at?: string | null;
          knowledge_base_status?: string | null;
          service_area?: string | null;
          updated_at?: string | null;
          website_faqs_generated?: number | null;
          website_url?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          active_insurance_claim?: boolean | null;
          active_stripe_case?: boolean | null;
          automation_level?: string | null;
          business_type?: string | null;
          company_logo_url?: string | null;
          company_name?: string | null;
          created_at?: string | null;
          custom_flags?: Json | null;
          email_domain?: string | null;
          id?: string;
          industry_faqs_copied?: number | null;
          is_hiring?: boolean | null;
          knowledge_base_completed_at?: string | null;
          knowledge_base_started_at?: string | null;
          knowledge_base_status?: string | null;
          service_area?: string | null;
          updated_at?: string | null;
          website_faqs_generated?: number | null;
          website_url?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'business_context_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: true;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      business_documents: {
        Row: {
          created_at: string | null;
          document_type: string;
          extracted_data: Json | null;
          extracted_text: string | null;
          file_size_bytes: number | null;
          file_url: string | null;
          id: string;
          last_used_at: string | null;
          mime_type: string | null;
          name: string;
          processed_at: string | null;
          processing_status: string | null;
          updated_at: string | null;
          usage_count: number | null;
          workspace_id: string;
        };
        Insert: {
          created_at?: string | null;
          document_type: string;
          extracted_data?: Json | null;
          extracted_text?: string | null;
          file_size_bytes?: number | null;
          file_url?: string | null;
          id?: string;
          last_used_at?: string | null;
          mime_type?: string | null;
          name: string;
          processed_at?: string | null;
          processing_status?: string | null;
          updated_at?: string | null;
          usage_count?: number | null;
          workspace_id: string;
        };
        Update: {
          created_at?: string | null;
          document_type?: string;
          extracted_data?: Json | null;
          extracted_text?: string | null;
          file_size_bytes?: number | null;
          file_url?: string | null;
          id?: string;
          last_used_at?: string | null;
          mime_type?: string | null;
          name?: string;
          processed_at?: string | null;
          processing_status?: string | null;
          updated_at?: string | null;
          usage_count?: number | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'business_documents_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      business_facts: {
        Row: {
          category: string;
          created_at: string | null;
          external_id: number | null;
          fact_key: string;
          fact_value: string;
          id: string;
          metadata: Json | null;
          updated_at: string | null;
          workspace_id: string | null;
        };
        Insert: {
          category: string;
          created_at?: string | null;
          external_id?: number | null;
          fact_key: string;
          fact_value: string;
          id?: string;
          metadata?: Json | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          category?: string;
          created_at?: string | null;
          external_id?: number | null;
          fact_key?: string;
          fact_value?: string;
          id?: string;
          metadata?: Json | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'business_facts_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      business_profile: {
        Row: {
          address: string | null;
          business_name: string;
          cancellation_policy: string | null;
          county: string | null;
          created_at: string | null;
          email: string | null;
          formatted_address: string | null;
          guarantee: string | null;
          id: string;
          industry: string | null;
          latitude: number | null;
          longitude: number | null;
          payment_methods: string | null;
          phone: string | null;
          place_id: string | null;
          price_summary: string | null;
          pricing_model: string | null;
          service_area: string | null;
          service_radius_miles: number | null;
          services: Json | null;
          tagline: string | null;
          tone: string | null;
          tone_description: string | null;
          updated_at: string | null;
          usps: Json | null;
          website: string | null;
          workspace_id: string;
        };
        Insert: {
          address?: string | null;
          business_name: string;
          cancellation_policy?: string | null;
          county?: string | null;
          created_at?: string | null;
          email?: string | null;
          formatted_address?: string | null;
          guarantee?: string | null;
          id?: string;
          industry?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          payment_methods?: string | null;
          phone?: string | null;
          place_id?: string | null;
          price_summary?: string | null;
          pricing_model?: string | null;
          service_area?: string | null;
          service_radius_miles?: number | null;
          services?: Json | null;
          tagline?: string | null;
          tone?: string | null;
          tone_description?: string | null;
          updated_at?: string | null;
          usps?: Json | null;
          website?: string | null;
          workspace_id: string;
        };
        Update: {
          address?: string | null;
          business_name?: string;
          cancellation_policy?: string | null;
          county?: string | null;
          created_at?: string | null;
          email?: string | null;
          formatted_address?: string | null;
          guarantee?: string | null;
          id?: string;
          industry?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          payment_methods?: string | null;
          phone?: string | null;
          place_id?: string | null;
          price_summary?: string | null;
          pricing_model?: string | null;
          service_area?: string | null;
          service_radius_miles?: number | null;
          services?: Json | null;
          tagline?: string | null;
          tone?: string | null;
          tone_description?: string | null;
          updated_at?: string | null;
          usps?: Json | null;
          website?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'business_profile_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: true;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      call_logs: {
        Row: {
          actions_taken: Json | null;
          agent_id: string;
          call_type: string | null;
          caller_name: string | null;
          caller_number: string | null;
          cost_cents: number | null;
          created_at: string | null;
          direction: string;
          disconnection_reason: string | null;
          duration_seconds: number | null;
          elevenlabs_conversation_id: string | null;
          id: string;
          outcome: string | null;
          recording_url: string | null;
          requires_followup: boolean | null;
          sentiment: string | null;
          status: string;
          success_evaluation: boolean | null;
          summary: string | null;
          topics: string[] | null;
          transcript: Json | null;
          workspace_id: string;
        };
        Insert: {
          actions_taken?: Json | null;
          agent_id: string;
          call_type?: string | null;
          caller_name?: string | null;
          caller_number?: string | null;
          cost_cents?: number | null;
          created_at?: string | null;
          direction?: string;
          disconnection_reason?: string | null;
          duration_seconds?: number | null;
          elevenlabs_conversation_id?: string | null;
          id?: string;
          outcome?: string | null;
          recording_url?: string | null;
          requires_followup?: boolean | null;
          sentiment?: string | null;
          status?: string;
          success_evaluation?: boolean | null;
          summary?: string | null;
          topics?: string[] | null;
          transcript?: Json | null;
          workspace_id: string;
        };
        Update: {
          actions_taken?: Json | null;
          agent_id?: string;
          call_type?: string | null;
          caller_name?: string | null;
          caller_number?: string | null;
          cost_cents?: number | null;
          created_at?: string | null;
          direction?: string;
          disconnection_reason?: string | null;
          duration_seconds?: number | null;
          elevenlabs_conversation_id?: string | null;
          id?: string;
          outcome?: string | null;
          recording_url?: string | null;
          requires_followup?: boolean | null;
          sentiment?: string | null;
          status?: string;
          success_evaluation?: boolean | null;
          summary?: string | null;
          topics?: string[] | null;
          transcript?: Json | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'call_logs_agent_id_fkey';
            columns: ['agent_id'];
            isOneToOne: false;
            referencedRelation: 'elevenlabs_agents';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'call_logs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      classification_corrections: {
        Row: {
          conversation_id: string | null;
          corrected_category: string | null;
          corrected_requires_reply: boolean | null;
          created_at: string | null;
          email_id: string | null;
          id: string;
          original_category: string | null;
          original_text: string | null;
          sender_email: string | null;
          subject: string | null;
          workspace_id: string;
        };
        Insert: {
          conversation_id?: string | null;
          corrected_category?: string | null;
          corrected_requires_reply?: boolean | null;
          created_at?: string | null;
          email_id?: string | null;
          id?: string;
          original_category?: string | null;
          original_text?: string | null;
          sender_email?: string | null;
          subject?: string | null;
          workspace_id: string;
        };
        Update: {
          conversation_id?: string | null;
          corrected_category?: string | null;
          corrected_requires_reply?: boolean | null;
          created_at?: string | null;
          email_id?: string | null;
          id?: string;
          original_category?: string | null;
          original_text?: string | null;
          sender_email?: string | null;
          subject?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'classification_corrections_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'bb_needs_classification';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'classification_corrections_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'classification_corrections_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'classification_corrections_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      classification_jobs: {
        Row: {
          classified_count: number | null;
          completed_at: string | null;
          created_at: string;
          error_message: string | null;
          failed_count: number | null;
          id: string;
          last_processed_id: string | null;
          retry_count: number | null;
          started_at: string | null;
          status: string;
          total_to_classify: number | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          classified_count?: number | null;
          completed_at?: string | null;
          created_at?: string;
          error_message?: string | null;
          failed_count?: number | null;
          id?: string;
          last_processed_id?: string | null;
          retry_count?: number | null;
          started_at?: string | null;
          status?: string;
          total_to_classify?: number | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          classified_count?: number | null;
          completed_at?: string | null;
          created_at?: string;
          error_message?: string | null;
          failed_count?: number | null;
          id?: string;
          last_processed_id?: string | null;
          retry_count?: number | null;
          started_at?: string | null;
          status?: string;
          total_to_classify?: number | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'classification_jobs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      competitor_faq_candidates: {
        Row: {
          answer: string;
          category: string | null;
          created_at: string | null;
          id: string;
          job_id: string;
          merged_into_faq_id: string | null;
          question: string;
          site_id: string | null;
          source_domain: string | null;
          status: string;
          workspace_id: string;
        };
        Insert: {
          answer: string;
          category?: string | null;
          created_at?: string | null;
          id?: string;
          job_id: string;
          merged_into_faq_id?: string | null;
          question: string;
          site_id?: string | null;
          source_domain?: string | null;
          status?: string;
          workspace_id: string;
        };
        Update: {
          answer?: string;
          category?: string | null;
          created_at?: string | null;
          id?: string;
          job_id?: string;
          merged_into_faq_id?: string | null;
          question?: string;
          site_id?: string | null;
          source_domain?: string | null;
          status?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'competitor_faq_candidates_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'competitor_research_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'competitor_faq_candidates_merged_into_faq_id_fkey';
            columns: ['merged_into_faq_id'];
            isOneToOne: false;
            referencedRelation: 'faq_database';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'competitor_faq_candidates_site_id_fkey';
            columns: ['site_id'];
            isOneToOne: false;
            referencedRelation: 'competitor_sites';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'competitor_faq_candidates_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      competitor_faqs_raw: {
        Row: {
          answer: string;
          category: string | null;
          created_at: string | null;
          duplicate_of: string | null;
          embedding: string | null;
          id: string;
          is_duplicate: boolean | null;
          is_refined: boolean | null;
          job_id: string | null;
          page_id: string | null;
          question: string;
          refined_faq_id: string | null;
          similarity_score: number | null;
          site_id: string | null;
          source_business: string | null;
          source_url: string | null;
          workspace_id: string;
        };
        Insert: {
          answer: string;
          category?: string | null;
          created_at?: string | null;
          duplicate_of?: string | null;
          embedding?: string | null;
          id?: string;
          is_duplicate?: boolean | null;
          is_refined?: boolean | null;
          job_id?: string | null;
          page_id?: string | null;
          question: string;
          refined_faq_id?: string | null;
          similarity_score?: number | null;
          site_id?: string | null;
          source_business?: string | null;
          source_url?: string | null;
          workspace_id: string;
        };
        Update: {
          answer?: string;
          category?: string | null;
          created_at?: string | null;
          duplicate_of?: string | null;
          embedding?: string | null;
          id?: string;
          is_duplicate?: boolean | null;
          is_refined?: boolean | null;
          job_id?: string | null;
          page_id?: string | null;
          question?: string;
          refined_faq_id?: string | null;
          similarity_score?: number | null;
          site_id?: string | null;
          source_business?: string | null;
          source_url?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'competitor_faqs_raw_duplicate_of_fkey';
            columns: ['duplicate_of'];
            isOneToOne: false;
            referencedRelation: 'competitor_faqs_raw';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'competitor_faqs_raw_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'competitor_research_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'competitor_faqs_raw_page_id_fkey';
            columns: ['page_id'];
            isOneToOne: false;
            referencedRelation: 'competitor_pages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'competitor_faqs_raw_refined_faq_id_fkey';
            columns: ['refined_faq_id'];
            isOneToOne: false;
            referencedRelation: 'faq_database';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'competitor_faqs_raw_site_id_fkey';
            columns: ['site_id'];
            isOneToOne: false;
            referencedRelation: 'competitor_sites';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'competitor_faqs_raw_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      competitor_pages: {
        Row: {
          content: string | null;
          faq_count: number | null;
          faqs_extracted: boolean | null;
          id: string;
          page_type: string | null;
          scraped_at: string | null;
          site_id: string;
          title: string | null;
          url: string;
          word_count: number | null;
          workspace_id: string;
        };
        Insert: {
          content?: string | null;
          faq_count?: number | null;
          faqs_extracted?: boolean | null;
          id?: string;
          page_type?: string | null;
          scraped_at?: string | null;
          site_id: string;
          title?: string | null;
          url: string;
          word_count?: number | null;
          workspace_id: string;
        };
        Update: {
          content?: string | null;
          faq_count?: number | null;
          faqs_extracted?: boolean | null;
          id?: string;
          page_type?: string | null;
          scraped_at?: string | null;
          site_id?: string;
          title?: string | null;
          url?: string;
          word_count?: number | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'competitor_pages_site_id_fkey';
            columns: ['site_id'];
            isOneToOne: false;
            referencedRelation: 'competitor_sites';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'competitor_pages_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      competitor_research_jobs: {
        Row: {
          checkpoint: Json | null;
          completed_at: string | null;
          created_at: string | null;
          current_scraping_domain: string | null;
          error_message: string | null;
          exclude_domains: string[] | null;
          faqs_added: number | null;
          faqs_after_dedup: number | null;
          faqs_embedded: number | null;
          faqs_extracted: number | null;
          faqs_generated: number | null;
          faqs_refined: number | null;
          heartbeat_at: string | null;
          id: string;
          industry: string | null;
          location: string | null;
          niche_query: string;
          pages_scraped: number | null;
          radius_miles: number | null;
          retry_count: number | null;
          search_queries: Json | null;
          service_area: string | null;
          sites_approved: number | null;
          sites_discovered: number | null;
          sites_scraped: number | null;
          sites_validated: number | null;
          started_at: string | null;
          status: string;
          target_count: number | null;
          updated_at: string | null;
          workspace_id: string;
        };
        Insert: {
          checkpoint?: Json | null;
          completed_at?: string | null;
          created_at?: string | null;
          current_scraping_domain?: string | null;
          error_message?: string | null;
          exclude_domains?: string[] | null;
          faqs_added?: number | null;
          faqs_after_dedup?: number | null;
          faqs_embedded?: number | null;
          faqs_extracted?: number | null;
          faqs_generated?: number | null;
          faqs_refined?: number | null;
          heartbeat_at?: string | null;
          id?: string;
          industry?: string | null;
          location?: string | null;
          niche_query: string;
          pages_scraped?: number | null;
          radius_miles?: number | null;
          retry_count?: number | null;
          search_queries?: Json | null;
          service_area?: string | null;
          sites_approved?: number | null;
          sites_discovered?: number | null;
          sites_scraped?: number | null;
          sites_validated?: number | null;
          started_at?: string | null;
          status?: string;
          target_count?: number | null;
          updated_at?: string | null;
          workspace_id: string;
        };
        Update: {
          checkpoint?: Json | null;
          completed_at?: string | null;
          created_at?: string | null;
          current_scraping_domain?: string | null;
          error_message?: string | null;
          exclude_domains?: string[] | null;
          faqs_added?: number | null;
          faqs_after_dedup?: number | null;
          faqs_embedded?: number | null;
          faqs_extracted?: number | null;
          faqs_generated?: number | null;
          faqs_refined?: number | null;
          heartbeat_at?: string | null;
          id?: string;
          industry?: string | null;
          location?: string | null;
          niche_query?: string;
          pages_scraped?: number | null;
          radius_miles?: number | null;
          retry_count?: number | null;
          search_queries?: Json | null;
          service_area?: string | null;
          sites_approved?: number | null;
          sites_discovered?: number | null;
          sites_scraped?: number | null;
          sites_validated?: number | null;
          started_at?: string | null;
          status?: string;
          target_count?: number | null;
          updated_at?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'competitor_research_jobs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      competitor_sites: {
        Row: {
          address: string | null;
          business_name: string | null;
          city: string | null;
          content_extracted: string | null;
          created_at: string | null;
          description: string | null;
          discovered_at: string | null;
          discovery_query: string | null;
          discovery_source: string | null;
          distance_km: number | null;
          distance_miles: number | null;
          domain: string;
          domain_type: string | null;
          faqs_generated: number | null;
          google_place_id: string | null;
          has_faq_page: boolean | null;
          has_pricing_page: boolean | null;
          id: string;
          is_directory: boolean | null;
          is_places_verified: boolean | null;
          is_selected: boolean | null;
          is_valid: boolean | null;
          job_id: string;
          latitude: number | null;
          location_data: Json | null;
          longitude: number | null;
          match_reason: string | null;
          pages_scraped: number | null;
          phone: string | null;
          place_id: string | null;
          postcode: string | null;
          priority_tier: string | null;
          quality_score: number | null;
          rating: number | null;
          rejection_reason: string | null;
          relevance_score: number | null;
          review_count: number | null;
          reviews_count: number | null;
          scrape_error: string | null;
          scrape_status: string | null;
          scraped_at: string | null;
          search_query_used: string | null;
          serp_position: number | null;
          status: string;
          title: string | null;
          total_words: number | null;
          url: string;
          validated_at: string | null;
          validation_reason: string | null;
          validation_status: string | null;
          workspace_id: string;
        };
        Insert: {
          address?: string | null;
          business_name?: string | null;
          city?: string | null;
          content_extracted?: string | null;
          created_at?: string | null;
          description?: string | null;
          discovered_at?: string | null;
          discovery_query?: string | null;
          discovery_source?: string | null;
          distance_km?: number | null;
          distance_miles?: number | null;
          domain: string;
          domain_type?: string | null;
          faqs_generated?: number | null;
          google_place_id?: string | null;
          has_faq_page?: boolean | null;
          has_pricing_page?: boolean | null;
          id?: string;
          is_directory?: boolean | null;
          is_places_verified?: boolean | null;
          is_selected?: boolean | null;
          is_valid?: boolean | null;
          job_id: string;
          latitude?: number | null;
          location_data?: Json | null;
          longitude?: number | null;
          match_reason?: string | null;
          pages_scraped?: number | null;
          phone?: string | null;
          place_id?: string | null;
          postcode?: string | null;
          priority_tier?: string | null;
          quality_score?: number | null;
          rating?: number | null;
          rejection_reason?: string | null;
          relevance_score?: number | null;
          review_count?: number | null;
          reviews_count?: number | null;
          scrape_error?: string | null;
          scrape_status?: string | null;
          scraped_at?: string | null;
          search_query_used?: string | null;
          serp_position?: number | null;
          status?: string;
          title?: string | null;
          total_words?: number | null;
          url: string;
          validated_at?: string | null;
          validation_reason?: string | null;
          validation_status?: string | null;
          workspace_id: string;
        };
        Update: {
          address?: string | null;
          business_name?: string | null;
          city?: string | null;
          content_extracted?: string | null;
          created_at?: string | null;
          description?: string | null;
          discovered_at?: string | null;
          discovery_query?: string | null;
          discovery_source?: string | null;
          distance_km?: number | null;
          distance_miles?: number | null;
          domain?: string;
          domain_type?: string | null;
          faqs_generated?: number | null;
          google_place_id?: string | null;
          has_faq_page?: boolean | null;
          has_pricing_page?: boolean | null;
          id?: string;
          is_directory?: boolean | null;
          is_places_verified?: boolean | null;
          is_selected?: boolean | null;
          is_valid?: boolean | null;
          job_id?: string;
          latitude?: number | null;
          location_data?: Json | null;
          longitude?: number | null;
          match_reason?: string | null;
          pages_scraped?: number | null;
          phone?: string | null;
          place_id?: string | null;
          postcode?: string | null;
          priority_tier?: string | null;
          quality_score?: number | null;
          rating?: number | null;
          rejection_reason?: string | null;
          relevance_score?: number | null;
          review_count?: number | null;
          reviews_count?: number | null;
          scrape_error?: string | null;
          scrape_status?: string | null;
          scraped_at?: string | null;
          search_query_used?: string | null;
          serp_position?: number | null;
          status?: string;
          title?: string | null;
          total_words?: number | null;
          url?: string;
          validated_at?: string | null;
          validation_reason?: string | null;
          validation_status?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'competitor_sites_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'competitor_research_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'competitor_sites_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      conversation_analytics: {
        Row: {
          avg_reply_length: number | null;
          avg_reply_time_hours: number | null;
          by_type: Json | null;
          conversations_with_replies: number | null;
          id: string;
          reply_rate: number | null;
          total_conversations: number | null;
          total_pairs: number | null;
          updated_at: string | null;
          workspace_id: string;
        };
        Insert: {
          avg_reply_length?: number | null;
          avg_reply_time_hours?: number | null;
          by_type?: Json | null;
          conversations_with_replies?: number | null;
          id?: string;
          reply_rate?: number | null;
          total_conversations?: number | null;
          total_pairs?: number | null;
          updated_at?: string | null;
          workspace_id: string;
        };
        Update: {
          avg_reply_length?: number | null;
          avg_reply_time_hours?: number | null;
          by_type?: Json | null;
          conversations_with_replies?: number | null;
          id?: string;
          reply_rate?: number | null;
          total_conversations?: number | null;
          total_pairs?: number | null;
          updated_at?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'conversation_analytics_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      conversation_pairs: {
        Row: {
          analyzed_in_phase3: boolean | null;
          conversation_id: string | null;
          created_at: string | null;
          id: string;
          inbound_body: string | null;
          inbound_message_id: string;
          inbound_type: string | null;
          outbound_body: string | null;
          outbound_message_id: string;
          received_at: string | null;
          reply_length: number | null;
          reply_time_hours: number | null;
          workspace_id: string;
        };
        Insert: {
          analyzed_in_phase3?: boolean | null;
          conversation_id?: string | null;
          created_at?: string | null;
          id?: string;
          inbound_body?: string | null;
          inbound_message_id: string;
          inbound_type?: string | null;
          outbound_body?: string | null;
          outbound_message_id: string;
          received_at?: string | null;
          reply_length?: number | null;
          reply_time_hours?: number | null;
          workspace_id: string;
        };
        Update: {
          analyzed_in_phase3?: boolean | null;
          conversation_id?: string | null;
          created_at?: string | null;
          id?: string;
          inbound_body?: string | null;
          inbound_message_id?: string;
          inbound_type?: string | null;
          outbound_body?: string | null;
          outbound_message_id?: string;
          received_at?: string | null;
          reply_length?: number | null;
          reply_time_hours?: number | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'conversation_pairs_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'bb_needs_classification';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'conversation_pairs_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversation_pairs_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'conversation_pairs_inbound_message_id_fkey';
            columns: ['inbound_message_id'];
            isOneToOne: false;
            referencedRelation: 'messages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversation_pairs_inbound_message_id_fkey';
            columns: ['inbound_message_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['inbound_id'];
          },
          {
            foreignKeyName: 'conversation_pairs_outbound_message_id_fkey';
            columns: ['outbound_message_id'];
            isOneToOne: false;
            referencedRelation: 'messages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversation_pairs_outbound_message_id_fkey';
            columns: ['outbound_message_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['inbound_id'];
          },
          {
            foreignKeyName: 'conversation_pairs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      conversation_refs: {
        Row: {
          channel: string;
          config_id: string;
          conversation_id: string;
          created_at: string;
          external_thread_id: string;
          id: string;
          workspace_id: string;
        };
        Insert: {
          channel: string;
          config_id: string;
          conversation_id: string;
          created_at?: string;
          external_thread_id: string;
          id?: string;
          workspace_id: string;
        };
        Update: {
          channel?: string;
          config_id?: string;
          conversation_id?: string;
          created_at?: string;
          external_thread_id?: string;
          id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'conversation_refs_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'bb_needs_classification';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'conversation_refs_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversation_refs_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['conversation_id'];
          },
        ];
      };
      conversations: {
        Row: {
          ai_confidence: number | null;
          ai_draft_response: string | null;
          ai_message_count: number | null;
          ai_reason_for_escalation: string | null;
          ai_resolution_summary: string | null;
          ai_sentiment: string | null;
          assigned_to: string | null;
          auto_handled_at: string | null;
          auto_responded: boolean | null;
          batch_group: string | null;
          category: string | null;
          channel: string;
          cognitive_load: string | null;
          confidence: number | null;
          config_id: string | null;
          conversation_type: string | null;
          created_at: string | null;
          csat_requested_at: string | null;
          csat_responded_at: string | null;
          customer_id: string | null;
          customer_satisfaction: number | null;
          decision_bucket: string | null;
          email_classification: string | null;
          embedding: string | null;
          escalated_at: string | null;
          evidence: Json | null;
          external_conversation_id: string | null;
          extracted_entities: Json | null;
          final_response: string | null;
          first_response_at: string | null;
          flags: Json | null;
          human_edited: boolean | null;
          id: string;
          is_escalated: boolean | null;
          lane: string | null;
          last_classified_message_id: string | null;
          last_classify_enqueued_message_id: string | null;
          last_draft_enqueued_message_id: string | null;
          last_draft_message_id: string | null;
          last_inbound_message_at: string | null;
          last_inbound_message_id: string | null;
          led_to_booking: boolean | null;
          message_count: number | null;
          metadata: Json | null;
          mode: string | null;
          needs_embedding: boolean | null;
          needs_review: boolean | null;
          priority: string | null;
          requires_reply: boolean | null;
          resolved_at: string | null;
          review_outcome: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          risk_level: string | null;
          sla_due_at: string | null;
          sla_status: string | null;
          sla_target_minutes: number | null;
          snoozed_until: string | null;
          source_id: string | null;
          status: string | null;
          suggested_actions: string[] | null;
          summary_for_human: string | null;
          thread_context: Json | null;
          title: string | null;
          triage_confidence: number | null;
          triage_reasoning: string | null;
          updated_at: string | null;
          urgency: string | null;
          urgency_reason: string | null;
          why_this_needs_you: string | null;
          workspace_id: string | null;
        };
        Insert: {
          ai_confidence?: number | null;
          ai_draft_response?: string | null;
          ai_message_count?: number | null;
          ai_reason_for_escalation?: string | null;
          ai_resolution_summary?: string | null;
          ai_sentiment?: string | null;
          assigned_to?: string | null;
          auto_handled_at?: string | null;
          auto_responded?: boolean | null;
          batch_group?: string | null;
          category?: string | null;
          channel: string;
          cognitive_load?: string | null;
          confidence?: number | null;
          config_id?: string | null;
          conversation_type?: string | null;
          created_at?: string | null;
          csat_requested_at?: string | null;
          csat_responded_at?: string | null;
          customer_id?: string | null;
          customer_satisfaction?: number | null;
          decision_bucket?: string | null;
          email_classification?: string | null;
          embedding?: string | null;
          escalated_at?: string | null;
          evidence?: Json | null;
          external_conversation_id?: string | null;
          extracted_entities?: Json | null;
          final_response?: string | null;
          first_response_at?: string | null;
          flags?: Json | null;
          human_edited?: boolean | null;
          id?: string;
          is_escalated?: boolean | null;
          lane?: string | null;
          last_classified_message_id?: string | null;
          last_classify_enqueued_message_id?: string | null;
          last_draft_enqueued_message_id?: string | null;
          last_draft_message_id?: string | null;
          last_inbound_message_at?: string | null;
          last_inbound_message_id?: string | null;
          led_to_booking?: boolean | null;
          message_count?: number | null;
          metadata?: Json | null;
          mode?: string | null;
          needs_embedding?: boolean | null;
          needs_review?: boolean | null;
          priority?: string | null;
          requires_reply?: boolean | null;
          resolved_at?: string | null;
          review_outcome?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          risk_level?: string | null;
          sla_due_at?: string | null;
          sla_status?: string | null;
          sla_target_minutes?: number | null;
          snoozed_until?: string | null;
          source_id?: string | null;
          status?: string | null;
          suggested_actions?: string[] | null;
          summary_for_human?: string | null;
          thread_context?: Json | null;
          title?: string | null;
          triage_confidence?: number | null;
          triage_reasoning?: string | null;
          updated_at?: string | null;
          urgency?: string | null;
          urgency_reason?: string | null;
          why_this_needs_you?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          ai_confidence?: number | null;
          ai_draft_response?: string | null;
          ai_message_count?: number | null;
          ai_reason_for_escalation?: string | null;
          ai_resolution_summary?: string | null;
          ai_sentiment?: string | null;
          assigned_to?: string | null;
          auto_handled_at?: string | null;
          auto_responded?: boolean | null;
          batch_group?: string | null;
          category?: string | null;
          channel?: string;
          cognitive_load?: string | null;
          confidence?: number | null;
          config_id?: string | null;
          conversation_type?: string | null;
          created_at?: string | null;
          csat_requested_at?: string | null;
          csat_responded_at?: string | null;
          customer_id?: string | null;
          customer_satisfaction?: number | null;
          decision_bucket?: string | null;
          email_classification?: string | null;
          embedding?: string | null;
          escalated_at?: string | null;
          evidence?: Json | null;
          external_conversation_id?: string | null;
          extracted_entities?: Json | null;
          final_response?: string | null;
          first_response_at?: string | null;
          flags?: Json | null;
          human_edited?: boolean | null;
          id?: string;
          is_escalated?: boolean | null;
          lane?: string | null;
          last_classified_message_id?: string | null;
          last_classify_enqueued_message_id?: string | null;
          last_draft_enqueued_message_id?: string | null;
          last_draft_message_id?: string | null;
          last_inbound_message_at?: string | null;
          last_inbound_message_id?: string | null;
          led_to_booking?: boolean | null;
          message_count?: number | null;
          metadata?: Json | null;
          mode?: string | null;
          needs_embedding?: boolean | null;
          needs_review?: boolean | null;
          priority?: string | null;
          requires_reply?: boolean | null;
          resolved_at?: string | null;
          review_outcome?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          risk_level?: string | null;
          sla_due_at?: string | null;
          sla_status?: string | null;
          sla_target_minutes?: number | null;
          snoozed_until?: string | null;
          source_id?: string | null;
          status?: string | null;
          suggested_actions?: string[] | null;
          summary_for_human?: string | null;
          thread_context?: Json | null;
          title?: string | null;
          triage_confidence?: number | null;
          triage_reasoning?: string | null;
          updated_at?: string | null;
          urgency?: string | null;
          urgency_reason?: string | null;
          why_this_needs_you?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'conversations_assigned_to_fkey';
            columns: ['assigned_to'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversations_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversations_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      correction_examples: {
        Row: {
          analysis: string | null;
          conversation_id: string | null;
          created_at: string | null;
          edited_draft: string;
          id: string;
          learnings: Json | null;
          original_draft: string;
          workspace_id: string;
        };
        Insert: {
          analysis?: string | null;
          conversation_id?: string | null;
          created_at?: string | null;
          edited_draft: string;
          id?: string;
          learnings?: Json | null;
          original_draft: string;
          workspace_id: string;
        };
        Update: {
          analysis?: string | null;
          conversation_id?: string | null;
          created_at?: string | null;
          edited_draft?: string;
          id?: string;
          learnings?: Json | null;
          original_draft?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'correction_examples_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'bb_needs_classification';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'correction_examples_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'correction_examples_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'correction_examples_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      customer_consents: {
        Row: {
          channel: string;
          consent_date: string | null;
          consent_given: boolean | null;
          consent_method: string | null;
          created_at: string | null;
          customer_id: string | null;
          id: string;
          lawful_basis: string | null;
          notes: string | null;
          purpose: string | null;
          updated_at: string | null;
          withdrawn_date: string | null;
        };
        Insert: {
          channel: string;
          consent_date?: string | null;
          consent_given?: boolean | null;
          consent_method?: string | null;
          created_at?: string | null;
          customer_id?: string | null;
          id?: string;
          lawful_basis?: string | null;
          notes?: string | null;
          purpose?: string | null;
          updated_at?: string | null;
          withdrawn_date?: string | null;
        };
        Update: {
          channel?: string;
          consent_date?: string | null;
          consent_given?: boolean | null;
          consent_method?: string | null;
          created_at?: string | null;
          customer_id?: string | null;
          id?: string;
          lawful_basis?: string | null;
          notes?: string | null;
          purpose?: string | null;
          updated_at?: string | null;
          withdrawn_date?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_consents_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
        ];
      };
      customer_identities: {
        Row: {
          created_at: string;
          customer_id: string;
          id: string;
          identifier_type: string;
          identifier_value: string;
          identifier_value_norm: string;
          source_channel: string | null;
          verified: boolean;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          customer_id: string;
          id?: string;
          identifier_type: string;
          identifier_value: string;
          identifier_value_norm: string;
          source_channel?: string | null;
          verified?: boolean;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          customer_id?: string;
          id?: string;
          identifier_type?: string;
          identifier_value?: string;
          identifier_value_norm?: string;
          source_channel?: string | null;
          verified?: boolean;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_identities_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
        ];
      };
      customer_insights: {
        Row: {
          confidence: number | null;
          created_at: string | null;
          customer_id: string;
          expires_at: string | null;
          id: string;
          insight_text: string;
          insight_type: string;
          source_conversations: string[] | null;
          workspace_id: string;
        };
        Insert: {
          confidence?: number | null;
          created_at?: string | null;
          customer_id: string;
          expires_at?: string | null;
          id?: string;
          insight_text: string;
          insight_type: string;
          source_conversations?: string[] | null;
          workspace_id: string;
        };
        Update: {
          confidence?: number | null;
          created_at?: string | null;
          customer_id?: string;
          expires_at?: string | null;
          id?: string;
          insight_text?: string;
          insight_type?: string;
          source_conversations?: string[] | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_insights_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_insights_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      customer_intelligence: {
        Row: {
          avg_response_time_hours: number | null;
          booking_pattern: Json | null;
          churn_risk: string | null;
          churn_signals: string[] | null;
          communication_style: string | null;
          confidence: number | null;
          created_at: string | null;
          customer_id: string;
          emails_analyzed: number | null;
          id: string;
          interaction_summary: string | null;
          last_analyzed_at: string | null;
          next_likely_contact_date: string | null;
          satisfaction_indicators: Json | null;
          services_used: string[] | null;
          suggested_actions: string[] | null;
          total_interactions: number | null;
          updated_at: string | null;
          upsell_opportunities: string[] | null;
          workspace_id: string;
        };
        Insert: {
          avg_response_time_hours?: number | null;
          booking_pattern?: Json | null;
          churn_risk?: string | null;
          churn_signals?: string[] | null;
          communication_style?: string | null;
          confidence?: number | null;
          created_at?: string | null;
          customer_id: string;
          emails_analyzed?: number | null;
          id?: string;
          interaction_summary?: string | null;
          last_analyzed_at?: string | null;
          next_likely_contact_date?: string | null;
          satisfaction_indicators?: Json | null;
          services_used?: string[] | null;
          suggested_actions?: string[] | null;
          total_interactions?: number | null;
          updated_at?: string | null;
          upsell_opportunities?: string[] | null;
          workspace_id: string;
        };
        Update: {
          avg_response_time_hours?: number | null;
          booking_pattern?: Json | null;
          churn_risk?: string | null;
          churn_signals?: string[] | null;
          communication_style?: string | null;
          confidence?: number | null;
          created_at?: string | null;
          customer_id?: string;
          emails_analyzed?: number | null;
          id?: string;
          interaction_summary?: string | null;
          last_analyzed_at?: string | null;
          next_likely_contact_date?: string | null;
          satisfaction_indicators?: Json | null;
          services_used?: string[] | null;
          suggested_actions?: string[] | null;
          total_interactions?: number | null;
          updated_at?: string | null;
          upsell_opportunities?: string[] | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_intelligence_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_intelligence_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      customers: {
        Row: {
          address: string | null;
          balance: number | null;
          created_at: string | null;
          custom_fields: Json | null;
          customer_id: string | null;
          email: string | null;
          embedding: string | null;
          frequency: string | null;
          id: string;
          last_updated: string | null;
          name: string | null;
          next_appointment: string | null;
          notes: string | null;
          payment_method: string | null;
          phone: string | null;
          preferred_channel: string | null;
          price: number | null;
          schedule_code: string | null;
          status: string | null;
          tier: string | null;
          updated_at: string | null;
          workspace_id: string | null;
        };
        Insert: {
          address?: string | null;
          balance?: number | null;
          created_at?: string | null;
          custom_fields?: Json | null;
          customer_id?: string | null;
          email?: string | null;
          embedding?: string | null;
          frequency?: string | null;
          id?: string;
          last_updated?: string | null;
          name?: string | null;
          next_appointment?: string | null;
          notes?: string | null;
          payment_method?: string | null;
          phone?: string | null;
          preferred_channel?: string | null;
          price?: number | null;
          schedule_code?: string | null;
          status?: string | null;
          tier?: string | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          address?: string | null;
          balance?: number | null;
          created_at?: string | null;
          custom_fields?: Json | null;
          customer_id?: string | null;
          email?: string | null;
          embedding?: string | null;
          frequency?: string | null;
          id?: string;
          last_updated?: string | null;
          name?: string | null;
          next_appointment?: string | null;
          notes?: string | null;
          payment_method?: string | null;
          phone?: string | null;
          preferred_channel?: string | null;
          price?: number | null;
          schedule_code?: string | null;
          status?: string | null;
          tier?: string | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'customers_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      dashboard_users: {
        Row: {
          created_at: string | null;
          email: string;
          id: string;
          name: string | null;
          password_hash: string;
          role: string | null;
        };
        Insert: {
          created_at?: string | null;
          email: string;
          id?: string;
          name?: string | null;
          password_hash: string;
          role?: string | null;
        };
        Update: {
          created_at?: string | null;
          email?: string;
          id?: string;
          name?: string | null;
          password_hash?: string;
          role?: string | null;
        };
        Relationships: [];
      };
      data_access_logs: {
        Row: {
          action: string;
          conversation_id: string | null;
          created_at: string | null;
          customer_id: string | null;
          id: string;
          ip_address: string | null;
          metadata: Json | null;
          new_value: Json | null;
          previous_value: Json | null;
          user_agent: string | null;
          user_id: string | null;
        };
        Insert: {
          action: string;
          conversation_id?: string | null;
          created_at?: string | null;
          customer_id?: string | null;
          id?: string;
          ip_address?: string | null;
          metadata?: Json | null;
          new_value?: Json | null;
          previous_value?: Json | null;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Update: {
          action?: string;
          conversation_id?: string | null;
          created_at?: string | null;
          customer_id?: string | null;
          id?: string;
          ip_address?: string | null;
          metadata?: Json | null;
          new_value?: Json | null;
          previous_value?: Json | null;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'data_access_logs_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'bb_needs_classification';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'data_access_logs_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'data_access_logs_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'data_access_logs_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'data_access_logs_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      data_deletion_requests: {
        Row: {
          completed_at: string | null;
          customer_id: string | null;
          deletion_type: string | null;
          id: string;
          notes: string | null;
          reason: string | null;
          requested_at: string | null;
          requested_by: string | null;
          reviewed_at: string | null;
          status: string | null;
        };
        Insert: {
          completed_at?: string | null;
          customer_id?: string | null;
          deletion_type?: string | null;
          id?: string;
          notes?: string | null;
          reason?: string | null;
          requested_at?: string | null;
          requested_by?: string | null;
          reviewed_at?: string | null;
          status?: string | null;
        };
        Update: {
          completed_at?: string | null;
          customer_id?: string | null;
          deletion_type?: string | null;
          id?: string;
          notes?: string | null;
          reason?: string | null;
          requested_at?: string | null;
          requested_by?: string | null;
          reviewed_at?: string | null;
          status?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'data_deletion_requests_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'data_deletion_requests_requested_by_fkey';
            columns: ['requested_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      data_retention_policies: {
        Row: {
          anonymize_instead_of_delete: boolean | null;
          auto_delete_enabled: boolean | null;
          created_at: string | null;
          exclude_vip_customers: boolean | null;
          id: string;
          retention_days: number;
          updated_at: string | null;
          workspace_id: string | null;
        };
        Insert: {
          anonymize_instead_of_delete?: boolean | null;
          auto_delete_enabled?: boolean | null;
          created_at?: string | null;
          exclude_vip_customers?: boolean | null;
          id?: string;
          retention_days?: number;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          anonymize_instead_of_delete?: boolean | null;
          auto_delete_enabled?: boolean | null;
          created_at?: string | null;
          exclude_vip_customers?: boolean | null;
          id?: string;
          retention_days?: number;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'data_retention_policies_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: true;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      directory_blocklist: {
        Row: {
          created_at: string | null;
          domain: string;
          id: string;
          reason: string | null;
        };
        Insert: {
          created_at?: string | null;
          domain: string;
          id?: string;
          reason?: string | null;
        };
        Update: {
          created_at?: string | null;
          domain?: string;
          id?: string;
          reason?: string | null;
        };
        Relationships: [];
      };
      document_chunks: {
        Row: {
          chunk_index: number;
          content: string;
          created_at: string | null;
          document_id: string;
          embedding: string | null;
          id: string;
          page_number: number | null;
          workspace_id: string;
        };
        Insert: {
          chunk_index: number;
          content: string;
          created_at?: string | null;
          document_id: string;
          embedding?: string | null;
          id?: string;
          page_number?: number | null;
          workspace_id: string;
        };
        Update: {
          chunk_index?: number;
          content?: string;
          created_at?: string | null;
          document_id?: string;
          embedding?: string | null;
          id?: string;
          page_number?: number | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'document_chunks_document_id_fkey';
            columns: ['document_id'];
            isOneToOne: false;
            referencedRelation: 'documents';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'document_chunks_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      documents: {
        Row: {
          created_at: string | null;
          error_message: string | null;
          extracted_text: string | null;
          file_path: string;
          file_size: number | null;
          file_type: string;
          id: string;
          name: string;
          page_count: number | null;
          processed_at: string | null;
          status: string | null;
          updated_at: string | null;
          workspace_id: string;
        };
        Insert: {
          created_at?: string | null;
          error_message?: string | null;
          extracted_text?: string | null;
          file_path: string;
          file_size?: number | null;
          file_type: string;
          id?: string;
          name: string;
          page_count?: number | null;
          processed_at?: string | null;
          status?: string | null;
          updated_at?: string | null;
          workspace_id: string;
        };
        Update: {
          created_at?: string | null;
          error_message?: string | null;
          extracted_text?: string | null;
          file_path?: string;
          file_size?: number | null;
          file_type?: string;
          id?: string;
          name?: string;
          page_count?: number | null;
          processed_at?: string | null;
          status?: string | null;
          updated_at?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'documents_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      draft_edits: {
        Row: {
          conversation_id: string | null;
          created_at: string | null;
          edit_distance: number | null;
          edit_type: string | null;
          edited_draft: string;
          id: string;
          original_draft: string;
          workspace_id: string | null;
        };
        Insert: {
          conversation_id?: string | null;
          created_at?: string | null;
          edit_distance?: number | null;
          edit_type?: string | null;
          edited_draft: string;
          id?: string;
          original_draft: string;
          workspace_id?: string | null;
        };
        Update: {
          conversation_id?: string | null;
          created_at?: string | null;
          edit_distance?: number | null;
          edit_type?: string | null;
          edited_draft?: string;
          id?: string;
          original_draft?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'draft_edits_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'bb_needs_classification';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'draft_edits_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'draft_edits_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'draft_edits_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      draft_verifications: {
        Row: {
          action_taken: string | null;
          auto_send_eligible: boolean | null;
          completeness_score: number | null;
          conversation_id: string | null;
          created_at: string | null;
          draft_generator: string | null;
          draft_text: string;
          factual_accuracy_score: number | null;
          id: string;
          issues: Json | null;
          message_id: string | null;
          overall_score: number | null;
          suggestions: Json | null;
          tone_appropriateness_score: number | null;
          verification_passed: boolean | null;
          verification_time_ms: number | null;
          voice_match_score: number | null;
          workspace_id: string;
        };
        Insert: {
          action_taken?: string | null;
          auto_send_eligible?: boolean | null;
          completeness_score?: number | null;
          conversation_id?: string | null;
          created_at?: string | null;
          draft_generator?: string | null;
          draft_text: string;
          factual_accuracy_score?: number | null;
          id?: string;
          issues?: Json | null;
          message_id?: string | null;
          overall_score?: number | null;
          suggestions?: Json | null;
          tone_appropriateness_score?: number | null;
          verification_passed?: boolean | null;
          verification_time_ms?: number | null;
          voice_match_score?: number | null;
          workspace_id: string;
        };
        Update: {
          action_taken?: string | null;
          auto_send_eligible?: boolean | null;
          completeness_score?: number | null;
          conversation_id?: string | null;
          created_at?: string | null;
          draft_generator?: string | null;
          draft_text?: string;
          factual_accuracy_score?: number | null;
          id?: string;
          issues?: Json | null;
          message_id?: string | null;
          overall_score?: number | null;
          suggestions?: Json | null;
          tone_appropriateness_score?: number | null;
          verification_passed?: boolean | null;
          verification_time_ms?: number | null;
          voice_match_score?: number | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'draft_verifications_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'bb_needs_classification';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'draft_verifications_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'draft_verifications_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'draft_verifications_message_id_fkey';
            columns: ['message_id'];
            isOneToOne: false;
            referencedRelation: 'messages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'draft_verifications_message_id_fkey';
            columns: ['message_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['inbound_id'];
          },
          {
            foreignKeyName: 'draft_verifications_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      elevenlabs_agents: {
        Row: {
          booking_rules: Json | null;
          business_description: string | null;
          business_name: string;
          created_at: string | null;
          custom_instructions: string | null;
          data_retention_days: number | null;
          elevenlabs_agent_id: string | null;
          greeting_message: string | null;
          id: string;
          is_active: boolean | null;
          knowledge_base_id: string | null;
          llm_model: string | null;
          max_call_duration_seconds: number | null;
          opening_hours: Json | null;
          phone_number: string | null;
          services: Json | null;
          status: string | null;
          transfer_number: string | null;
          twilio_number_sid: string | null;
          updated_at: string | null;
          voice_id: string | null;
          voice_name: string | null;
          workspace_id: string;
        };
        Insert: {
          booking_rules?: Json | null;
          business_description?: string | null;
          business_name: string;
          created_at?: string | null;
          custom_instructions?: string | null;
          data_retention_days?: number | null;
          elevenlabs_agent_id?: string | null;
          greeting_message?: string | null;
          id?: string;
          is_active?: boolean | null;
          knowledge_base_id?: string | null;
          llm_model?: string | null;
          max_call_duration_seconds?: number | null;
          opening_hours?: Json | null;
          phone_number?: string | null;
          services?: Json | null;
          status?: string | null;
          transfer_number?: string | null;
          twilio_number_sid?: string | null;
          updated_at?: string | null;
          voice_id?: string | null;
          voice_name?: string | null;
          workspace_id: string;
        };
        Update: {
          booking_rules?: Json | null;
          business_description?: string | null;
          business_name?: string;
          created_at?: string | null;
          custom_instructions?: string | null;
          data_retention_days?: number | null;
          elevenlabs_agent_id?: string | null;
          greeting_message?: string | null;
          id?: string;
          is_active?: boolean | null;
          knowledge_base_id?: string | null;
          llm_model?: string | null;
          max_call_duration_seconds?: number | null;
          opening_hours?: Json | null;
          phone_number?: string | null;
          services?: Json | null;
          status?: string | null;
          transfer_number?: string | null;
          twilio_number_sid?: string | null;
          updated_at?: string | null;
          voice_id?: string | null;
          voice_name?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'elevenlabs_agents_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: true;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      email_fetch_retries: {
        Row: {
          attempt_count: number | null;
          created_at: string | null;
          external_id: string;
          id: string;
          job_id: string | null;
          last_error: string | null;
          last_status_code: number | null;
          max_attempts: number | null;
          next_retry_at: string | null;
          updated_at: string | null;
          workspace_id: string;
        };
        Insert: {
          attempt_count?: number | null;
          created_at?: string | null;
          external_id: string;
          id?: string;
          job_id?: string | null;
          last_error?: string | null;
          last_status_code?: number | null;
          max_attempts?: number | null;
          next_retry_at?: string | null;
          updated_at?: string | null;
          workspace_id: string;
        };
        Update: {
          attempt_count?: number | null;
          created_at?: string | null;
          external_id?: string;
          id?: string;
          job_id?: string | null;
          last_error?: string | null;
          last_status_code?: number | null;
          max_attempts?: number | null;
          next_retry_at?: string | null;
          updated_at?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'email_fetch_retries_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      email_import_jobs: {
        Row: {
          bodies_fetched: number | null;
          bodies_skipped: number | null;
          checkpoint: Json | null;
          completed_at: string | null;
          config_id: string;
          conversation_threads: number | null;
          created_at: string | null;
          error_details: Json | null;
          error_message: string | null;
          heartbeat_at: string | null;
          id: string;
          import_mode: string | null;
          inbox_emails_scanned: number | null;
          messages_created: number | null;
          retry_count: number | null;
          sent_emails_scanned: number | null;
          started_at: string | null;
          status: string;
          total_threads_found: number | null;
          updated_at: string | null;
          workspace_id: string;
        };
        Insert: {
          bodies_fetched?: number | null;
          bodies_skipped?: number | null;
          checkpoint?: Json | null;
          completed_at?: string | null;
          config_id: string;
          conversation_threads?: number | null;
          created_at?: string | null;
          error_details?: Json | null;
          error_message?: string | null;
          heartbeat_at?: string | null;
          id?: string;
          import_mode?: string | null;
          inbox_emails_scanned?: number | null;
          messages_created?: number | null;
          retry_count?: number | null;
          sent_emails_scanned?: number | null;
          started_at?: string | null;
          status?: string;
          total_threads_found?: number | null;
          updated_at?: string | null;
          workspace_id: string;
        };
        Update: {
          bodies_fetched?: number | null;
          bodies_skipped?: number | null;
          checkpoint?: Json | null;
          completed_at?: string | null;
          config_id?: string;
          conversation_threads?: number | null;
          created_at?: string | null;
          error_details?: Json | null;
          error_message?: string | null;
          heartbeat_at?: string | null;
          id?: string;
          import_mode?: string | null;
          inbox_emails_scanned?: number | null;
          messages_created?: number | null;
          retry_count?: number | null;
          sent_emails_scanned?: number | null;
          started_at?: string | null;
          status?: string;
          total_threads_found?: number | null;
          updated_at?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'email_import_jobs_config_id_fkey';
            columns: ['config_id'];
            isOneToOne: false;
            referencedRelation: 'email_provider_configs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'email_import_jobs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      email_import_progress: {
        Row: {
          aurinko_next_page_token: string | null;
          conversations_found: number | null;
          conversations_with_replies: number | null;
          created_at: string | null;
          current_import_folder: string | null;
          current_phase: string | null;
          emails_classified: number | null;
          emails_failed: number | null;
          emails_received: number | null;
          estimated_completion_at: string | null;
          estimated_minutes: number | null;
          estimated_total_emails: number | null;
          id: string;
          inbox_email_count: number | null;
          inbox_import_complete: boolean | null;
          inbox_next_page_token: string | null;
          last_error: string | null;
          last_import_batch_at: string | null;
          pairs_analyzed: number | null;
          paused_reason: string | null;
          phase1_completed_at: string | null;
          phase1_status: string | null;
          phase2_completed_at: string | null;
          phase2_status: string | null;
          phase3_completed_at: string | null;
          phase3_status: string | null;
          playbook_complete: boolean | null;
          resume_after: string | null;
          run_id: string | null;
          sent_email_count: number | null;
          sent_import_complete: boolean | null;
          sent_next_page_token: string | null;
          started_at: string | null;
          updated_at: string | null;
          voice_profile_complete: boolean | null;
          workspace_id: string;
        };
        Insert: {
          aurinko_next_page_token?: string | null;
          conversations_found?: number | null;
          conversations_with_replies?: number | null;
          created_at?: string | null;
          current_import_folder?: string | null;
          current_phase?: string | null;
          emails_classified?: number | null;
          emails_failed?: number | null;
          emails_received?: number | null;
          estimated_completion_at?: string | null;
          estimated_minutes?: number | null;
          estimated_total_emails?: number | null;
          id?: string;
          inbox_email_count?: number | null;
          inbox_import_complete?: boolean | null;
          inbox_next_page_token?: string | null;
          last_error?: string | null;
          last_import_batch_at?: string | null;
          pairs_analyzed?: number | null;
          paused_reason?: string | null;
          phase1_completed_at?: string | null;
          phase1_status?: string | null;
          phase2_completed_at?: string | null;
          phase2_status?: string | null;
          phase3_completed_at?: string | null;
          phase3_status?: string | null;
          playbook_complete?: boolean | null;
          resume_after?: string | null;
          run_id?: string | null;
          sent_email_count?: number | null;
          sent_import_complete?: boolean | null;
          sent_next_page_token?: string | null;
          started_at?: string | null;
          updated_at?: string | null;
          voice_profile_complete?: boolean | null;
          workspace_id: string;
        };
        Update: {
          aurinko_next_page_token?: string | null;
          conversations_found?: number | null;
          conversations_with_replies?: number | null;
          created_at?: string | null;
          current_import_folder?: string | null;
          current_phase?: string | null;
          emails_classified?: number | null;
          emails_failed?: number | null;
          emails_received?: number | null;
          estimated_completion_at?: string | null;
          estimated_minutes?: number | null;
          estimated_total_emails?: number | null;
          id?: string;
          inbox_email_count?: number | null;
          inbox_import_complete?: boolean | null;
          inbox_next_page_token?: string | null;
          last_error?: string | null;
          last_import_batch_at?: string | null;
          pairs_analyzed?: number | null;
          paused_reason?: string | null;
          phase1_completed_at?: string | null;
          phase1_status?: string | null;
          phase2_completed_at?: string | null;
          phase2_status?: string | null;
          phase3_completed_at?: string | null;
          phase3_status?: string | null;
          playbook_complete?: boolean | null;
          resume_after?: string | null;
          run_id?: string | null;
          sent_email_count?: number | null;
          sent_import_complete?: boolean | null;
          sent_next_page_token?: string | null;
          started_at?: string | null;
          updated_at?: string | null;
          voice_profile_complete?: boolean | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'email_import_progress_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: true;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      email_import_queue: {
        Row: {
          body: string | null;
          body_html: string | null;
          config_id: string;
          created_at: string | null;
          direction: string;
          error_message: string | null;
          external_id: string;
          fetched_at: string | null;
          from_email: string | null;
          from_name: string | null;
          has_body: boolean | null;
          id: string;
          is_noise: boolean | null;
          job_id: string | null;
          noise_reason: string | null;
          processed_at: string | null;
          received_at: string | null;
          status: string | null;
          subject: string | null;
          thread_id: string;
          to_emails: string[] | null;
          workspace_id: string;
        };
        Insert: {
          body?: string | null;
          body_html?: string | null;
          config_id: string;
          created_at?: string | null;
          direction: string;
          error_message?: string | null;
          external_id: string;
          fetched_at?: string | null;
          from_email?: string | null;
          from_name?: string | null;
          has_body?: boolean | null;
          id?: string;
          is_noise?: boolean | null;
          job_id?: string | null;
          noise_reason?: string | null;
          processed_at?: string | null;
          received_at?: string | null;
          status?: string | null;
          subject?: string | null;
          thread_id: string;
          to_emails?: string[] | null;
          workspace_id: string;
        };
        Update: {
          body?: string | null;
          body_html?: string | null;
          config_id?: string;
          created_at?: string | null;
          direction?: string;
          error_message?: string | null;
          external_id?: string;
          fetched_at?: string | null;
          from_email?: string | null;
          from_name?: string | null;
          has_body?: boolean | null;
          id?: string;
          is_noise?: boolean | null;
          job_id?: string | null;
          noise_reason?: string | null;
          processed_at?: string | null;
          received_at?: string | null;
          status?: string | null;
          subject?: string | null;
          thread_id?: string;
          to_emails?: string[] | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'email_import_queue_config_id_fkey';
            columns: ['config_id'];
            isOneToOne: false;
            referencedRelation: 'email_provider_configs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'email_import_queue_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      email_pairs: {
        Row: {
          category: string | null;
          conversation_id: string | null;
          created_at: string | null;
          embedding: string | null;
          id: string;
          inbound_body: string | null;
          inbound_from: string | null;
          inbound_message_id: string | null;
          inbound_received_at: string | null;
          inbound_subject: string | null;
          led_to_booking: boolean | null;
          led_to_reply: boolean | null;
          outbound_body: string | null;
          outbound_message_id: string | null;
          outbound_sent_at: string | null;
          quality_score: number | null;
          response_has_cta: boolean | null;
          response_has_price: boolean | null;
          response_has_question: boolean | null;
          response_time_minutes: number | null;
          response_word_count: number | null;
          sentiment_inbound: string | null;
          sentiment_outbound: string | null;
          subcategory: string | null;
          workspace_id: string | null;
        };
        Insert: {
          category?: string | null;
          conversation_id?: string | null;
          created_at?: string | null;
          embedding?: string | null;
          id?: string;
          inbound_body?: string | null;
          inbound_from?: string | null;
          inbound_message_id?: string | null;
          inbound_received_at?: string | null;
          inbound_subject?: string | null;
          led_to_booking?: boolean | null;
          led_to_reply?: boolean | null;
          outbound_body?: string | null;
          outbound_message_id?: string | null;
          outbound_sent_at?: string | null;
          quality_score?: number | null;
          response_has_cta?: boolean | null;
          response_has_price?: boolean | null;
          response_has_question?: boolean | null;
          response_time_minutes?: number | null;
          response_word_count?: number | null;
          sentiment_inbound?: string | null;
          sentiment_outbound?: string | null;
          subcategory?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          category?: string | null;
          conversation_id?: string | null;
          created_at?: string | null;
          embedding?: string | null;
          id?: string;
          inbound_body?: string | null;
          inbound_from?: string | null;
          inbound_message_id?: string | null;
          inbound_received_at?: string | null;
          inbound_subject?: string | null;
          led_to_booking?: boolean | null;
          led_to_reply?: boolean | null;
          outbound_body?: string | null;
          outbound_message_id?: string | null;
          outbound_sent_at?: string | null;
          quality_score?: number | null;
          response_has_cta?: boolean | null;
          response_has_price?: boolean | null;
          response_has_question?: boolean | null;
          response_time_minutes?: number | null;
          response_word_count?: number | null;
          sentiment_inbound?: string | null;
          sentiment_outbound?: string | null;
          subcategory?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'email_pairs_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'bb_needs_classification';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'email_pairs_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'email_pairs_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'email_pairs_inbound_message_id_fkey';
            columns: ['inbound_message_id'];
            isOneToOne: false;
            referencedRelation: 'messages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'email_pairs_inbound_message_id_fkey';
            columns: ['inbound_message_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['inbound_id'];
          },
          {
            foreignKeyName: 'email_pairs_outbound_message_id_fkey';
            columns: ['outbound_message_id'];
            isOneToOne: false;
            referencedRelation: 'messages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'email_pairs_outbound_message_id_fkey';
            columns: ['outbound_message_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['inbound_id'];
          },
          {
            foreignKeyName: 'email_pairs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      email_provider_configs: {
        Row: {
          access_token: string | null;
          access_token_encrypted: string | null;
          account_id: string;
          active_job_id: string | null;
          aliases: string[] | null;
          automation_level: string | null;
          connected_at: string | null;
          created_at: string | null;
          email_address: string;
          encryption_key_id: string | null;
          id: string;
          import_mode: string | null;
          inbound_emails_found: number | null;
          inbound_total: number | null;
          last_sync_at: string | null;
          outbound_emails_found: number | null;
          outbound_total: number | null;
          provider: string;
          refresh_token: string | null;
          subscription_expires_at: string | null;
          subscription_id: string | null;
          sync_completed_at: string | null;
          sync_error: string | null;
          sync_progress: number | null;
          sync_stage: string | null;
          sync_started_at: string | null;
          sync_status: string | null;
          sync_total: number | null;
          threads_linked: number | null;
          token_expires_at: string | null;
          updated_at: string | null;
          voice_profile_status: string | null;
          workspace_id: string;
        };
        Insert: {
          access_token?: string | null;
          access_token_encrypted?: string | null;
          account_id: string;
          active_job_id?: string | null;
          aliases?: string[] | null;
          automation_level?: string | null;
          connected_at?: string | null;
          created_at?: string | null;
          email_address: string;
          encryption_key_id?: string | null;
          id?: string;
          import_mode?: string | null;
          inbound_emails_found?: number | null;
          inbound_total?: number | null;
          last_sync_at?: string | null;
          outbound_emails_found?: number | null;
          outbound_total?: number | null;
          provider: string;
          refresh_token?: string | null;
          subscription_expires_at?: string | null;
          subscription_id?: string | null;
          sync_completed_at?: string | null;
          sync_error?: string | null;
          sync_progress?: number | null;
          sync_stage?: string | null;
          sync_started_at?: string | null;
          sync_status?: string | null;
          sync_total?: number | null;
          threads_linked?: number | null;
          token_expires_at?: string | null;
          updated_at?: string | null;
          voice_profile_status?: string | null;
          workspace_id: string;
        };
        Update: {
          access_token?: string | null;
          access_token_encrypted?: string | null;
          account_id?: string;
          active_job_id?: string | null;
          aliases?: string[] | null;
          automation_level?: string | null;
          connected_at?: string | null;
          created_at?: string | null;
          email_address?: string;
          encryption_key_id?: string | null;
          id?: string;
          import_mode?: string | null;
          inbound_emails_found?: number | null;
          inbound_total?: number | null;
          last_sync_at?: string | null;
          outbound_emails_found?: number | null;
          outbound_total?: number | null;
          provider?: string;
          refresh_token?: string | null;
          subscription_expires_at?: string | null;
          subscription_id?: string | null;
          sync_completed_at?: string | null;
          sync_error?: string | null;
          sync_progress?: number | null;
          sync_stage?: string | null;
          sync_started_at?: string | null;
          sync_status?: string | null;
          sync_total?: number | null;
          threads_linked?: number | null;
          token_expires_at?: string | null;
          updated_at?: string | null;
          voice_profile_status?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'email_provider_configs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      email_settings: {
        Row: {
          company_address: string | null;
          company_name: string | null;
          company_phone: string | null;
          company_website: string | null;
          created_at: string | null;
          from_name: string | null;
          id: string;
          logo_url: string | null;
          reply_to_email: string | null;
          signature_html: string | null;
          updated_at: string | null;
          workspace_id: string | null;
        };
        Insert: {
          company_address?: string | null;
          company_name?: string | null;
          company_phone?: string | null;
          company_website?: string | null;
          created_at?: string | null;
          from_name?: string | null;
          id?: string;
          logo_url?: string | null;
          reply_to_email?: string | null;
          signature_html?: string | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          company_address?: string | null;
          company_name?: string | null;
          company_phone?: string | null;
          company_website?: string | null;
          created_at?: string | null;
          from_name?: string | null;
          id?: string;
          logo_url?: string | null;
          reply_to_email?: string | null;
          signature_html?: string | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'email_settings_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      email_sync_jobs: {
        Row: {
          completed_at: string | null;
          config_id: string;
          created_at: string | null;
          error_message: string | null;
          id: string;
          import_mode: string;
          inbound_cursor: string | null;
          inbound_processed: number | null;
          last_batch_at: string | null;
          sent_cursor: string | null;
          sent_processed: number | null;
          started_at: string | null;
          status: string;
          threads_linked: number | null;
          updated_at: string | null;
          workspace_id: string;
        };
        Insert: {
          completed_at?: string | null;
          config_id: string;
          created_at?: string | null;
          error_message?: string | null;
          id?: string;
          import_mode: string;
          inbound_cursor?: string | null;
          inbound_processed?: number | null;
          last_batch_at?: string | null;
          sent_cursor?: string | null;
          sent_processed?: number | null;
          started_at?: string | null;
          status?: string;
          threads_linked?: number | null;
          updated_at?: string | null;
          workspace_id: string;
        };
        Update: {
          completed_at?: string | null;
          config_id?: string;
          created_at?: string | null;
          error_message?: string | null;
          id?: string;
          import_mode?: string;
          inbound_cursor?: string | null;
          inbound_processed?: number | null;
          last_batch_at?: string | null;
          sent_cursor?: string | null;
          sent_processed?: number | null;
          started_at?: string | null;
          status?: string;
          threads_linked?: number | null;
          updated_at?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'email_sync_jobs_config_id_fkey';
            columns: ['config_id'];
            isOneToOne: false;
            referencedRelation: 'email_provider_configs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'email_sync_jobs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      email_thread_analysis: {
        Row: {
          bodies_fetched: boolean | null;
          conversation_created: boolean | null;
          conversation_id: string | null;
          created_at: string | null;
          first_inbound_id: string | null;
          first_outbound_id: string | null;
          id: string;
          inbound_count: number | null;
          is_conversation: boolean | null;
          is_noise_thread: boolean | null;
          job_id: string | null;
          latest_inbound_id: string | null;
          latest_outbound_id: string | null;
          needs_body_fetch: boolean | null;
          outbound_count: number | null;
          thread_id: string;
          total_count: number | null;
          workspace_id: string;
        };
        Insert: {
          bodies_fetched?: boolean | null;
          conversation_created?: boolean | null;
          conversation_id?: string | null;
          created_at?: string | null;
          first_inbound_id?: string | null;
          first_outbound_id?: string | null;
          id?: string;
          inbound_count?: number | null;
          is_conversation?: boolean | null;
          is_noise_thread?: boolean | null;
          job_id?: string | null;
          latest_inbound_id?: string | null;
          latest_outbound_id?: string | null;
          needs_body_fetch?: boolean | null;
          outbound_count?: number | null;
          thread_id: string;
          total_count?: number | null;
          workspace_id: string;
        };
        Update: {
          bodies_fetched?: boolean | null;
          conversation_created?: boolean | null;
          conversation_id?: string | null;
          created_at?: string | null;
          first_inbound_id?: string | null;
          first_outbound_id?: string | null;
          id?: string;
          inbound_count?: number | null;
          is_conversation?: boolean | null;
          is_noise_thread?: boolean | null;
          job_id?: string | null;
          latest_inbound_id?: string | null;
          latest_outbound_id?: string | null;
          needs_body_fetch?: boolean | null;
          outbound_count?: number | null;
          thread_id?: string;
          total_count?: number | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'email_thread_analysis_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      escalated_messages: {
        Row: {
          channel: Database['public']['Enums']['message_channel'];
          conversation_context: Json | null;
          created_at: string | null;
          customer_identifier: string;
          customer_name: string | null;
          escalated_at: string | null;
          id: string;
          message_content: string;
          metadata: Json | null;
          n8n_workflow_id: string | null;
          priority: string | null;
          responded_at: string | null;
          status: Database['public']['Enums']['message_status'] | null;
          updated_at: string | null;
          workspace_id: string | null;
        };
        Insert: {
          channel: Database['public']['Enums']['message_channel'];
          conversation_context?: Json | null;
          created_at?: string | null;
          customer_identifier: string;
          customer_name?: string | null;
          escalated_at?: string | null;
          id?: string;
          message_content: string;
          metadata?: Json | null;
          n8n_workflow_id?: string | null;
          priority?: string | null;
          responded_at?: string | null;
          status?: Database['public']['Enums']['message_status'] | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          channel?: Database['public']['Enums']['message_channel'];
          conversation_context?: Json | null;
          created_at?: string | null;
          customer_identifier?: string;
          customer_name?: string | null;
          escalated_at?: string | null;
          id?: string;
          message_content?: string;
          metadata?: Json | null;
          n8n_workflow_id?: string | null;
          priority?: string | null;
          responded_at?: string | null;
          status?: Database['public']['Enums']['message_status'] | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'escalated_messages_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      faq_database: {
        Row: {
          answer: string;
          archived: boolean | null;
          category: string;
          created_at: string | null;
          embedding: string | null;
          enabled: boolean | null;
          external_id: number | null;
          generation_source: string | null;
          id: string;
          is_active: boolean | null;
          is_industry_standard: boolean | null;
          is_own_content: boolean | null;
          keywords: string[] | null;
          original_faq_id: string | null;
          priority: number | null;
          question: string;
          refined_at: string | null;
          relevance_score: number | null;
          source_business: string | null;
          source_company: string | null;
          source_url: string | null;
          updated_at: string | null;
          workspace_id: string | null;
        };
        Insert: {
          answer: string;
          archived?: boolean | null;
          category: string;
          created_at?: string | null;
          embedding?: string | null;
          enabled?: boolean | null;
          external_id?: number | null;
          generation_source?: string | null;
          id?: string;
          is_active?: boolean | null;
          is_industry_standard?: boolean | null;
          is_own_content?: boolean | null;
          keywords?: string[] | null;
          original_faq_id?: string | null;
          priority?: number | null;
          question: string;
          refined_at?: string | null;
          relevance_score?: number | null;
          source_business?: string | null;
          source_company?: string | null;
          source_url?: string | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          answer?: string;
          archived?: boolean | null;
          category?: string;
          created_at?: string | null;
          embedding?: string | null;
          enabled?: boolean | null;
          external_id?: number | null;
          generation_source?: string | null;
          id?: string;
          is_active?: boolean | null;
          is_industry_standard?: boolean | null;
          is_own_content?: boolean | null;
          keywords?: string[] | null;
          original_faq_id?: string | null;
          priority?: number | null;
          question?: string;
          refined_at?: string | null;
          relevance_score?: number | null;
          source_business?: string | null;
          source_company?: string | null;
          source_url?: string | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'faq_database_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      faqs: {
        Row: {
          answer: string;
          category: string | null;
          created_at: string | null;
          embedding: string | null;
          id: string;
          priority: number | null;
          question: string;
          source: string | null;
          updated_at: string | null;
          workspace_id: string;
        };
        Insert: {
          answer: string;
          category?: string | null;
          created_at?: string | null;
          embedding?: string | null;
          id?: string;
          priority?: number | null;
          question: string;
          source?: string | null;
          updated_at?: string | null;
          workspace_id: string;
        };
        Update: {
          answer?: string;
          category?: string | null;
          created_at?: string | null;
          embedding?: string | null;
          id?: string;
          priority?: number | null;
          question?: string;
          source?: string | null;
          updated_at?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'faqs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      few_shot_examples: {
        Row: {
          category: string;
          created_at: string | null;
          email_pair_id: string | null;
          embedding: string | null;
          id: string;
          inbound_text: string | null;
          outbound_text: string | null;
          quality_score: number | null;
          rank_in_category: number | null;
          selection_reason: string | null;
          workspace_id: string | null;
        };
        Insert: {
          category: string;
          created_at?: string | null;
          email_pair_id?: string | null;
          embedding?: string | null;
          id?: string;
          inbound_text?: string | null;
          outbound_text?: string | null;
          quality_score?: number | null;
          rank_in_category?: number | null;
          selection_reason?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          category?: string;
          created_at?: string | null;
          email_pair_id?: string | null;
          embedding?: string | null;
          id?: string;
          inbound_text?: string | null;
          outbound_text?: string | null;
          quality_score?: number | null;
          rank_in_category?: number | null;
          selection_reason?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'few_shot_examples_email_pair_id_fkey';
            columns: ['email_pair_id'];
            isOneToOne: false;
            referencedRelation: 'email_pairs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'few_shot_examples_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      folder_cursors: {
        Row: {
          created_at: string | null;
          emails_found: number | null;
          folder_id: string | null;
          folder_name: string;
          id: string;
          is_complete: boolean | null;
          job_id: string;
          last_processed_at: string | null;
          next_page_token: string | null;
          priority: number | null;
          workspace_id: string;
        };
        Insert: {
          created_at?: string | null;
          emails_found?: number | null;
          folder_id?: string | null;
          folder_name: string;
          id?: string;
          is_complete?: boolean | null;
          job_id: string;
          last_processed_at?: string | null;
          next_page_token?: string | null;
          priority?: number | null;
          workspace_id: string;
        };
        Update: {
          created_at?: string | null;
          emails_found?: number | null;
          folder_id?: string | null;
          folder_name?: string;
          id?: string;
          is_complete?: boolean | null;
          job_id?: string;
          last_processed_at?: string | null;
          next_page_token?: string | null;
          priority?: number | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'folder_cursors_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'import_jobs';
            referencedColumns: ['id'];
          },
        ];
      };
      gmail_channel_configs: {
        Row: {
          access_token: string | null;
          access_token_encrypted: string | null;
          connected_at: string | null;
          created_at: string | null;
          email_address: string;
          encryption_key_id: string | null;
          history_id: string | null;
          id: string;
          import_mode: string | null;
          last_sync_at: string | null;
          refresh_token: string | null;
          refresh_token_encrypted: string | null;
          token_expires_at: string | null;
          updated_at: string | null;
          watch_expiration: string | null;
          workspace_id: string | null;
        };
        Insert: {
          access_token?: string | null;
          access_token_encrypted?: string | null;
          connected_at?: string | null;
          created_at?: string | null;
          email_address: string;
          encryption_key_id?: string | null;
          history_id?: string | null;
          id?: string;
          import_mode?: string | null;
          last_sync_at?: string | null;
          refresh_token?: string | null;
          refresh_token_encrypted?: string | null;
          token_expires_at?: string | null;
          updated_at?: string | null;
          watch_expiration?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          access_token?: string | null;
          access_token_encrypted?: string | null;
          connected_at?: string | null;
          created_at?: string | null;
          email_address?: string;
          encryption_key_id?: string | null;
          history_id?: string | null;
          id?: string;
          import_mode?: string | null;
          last_sync_at?: string | null;
          refresh_token?: string | null;
          refresh_token_encrypted?: string | null;
          token_expires_at?: string | null;
          updated_at?: string | null;
          watch_expiration?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'gmail_channel_configs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      ground_truth_facts: {
        Row: {
          confidence: number | null;
          created_at: string | null;
          fact_key: string;
          fact_type: string;
          fact_value: string;
          id: string;
          source_url: string | null;
          workspace_id: string;
        };
        Insert: {
          confidence?: number | null;
          created_at?: string | null;
          fact_key: string;
          fact_type: string;
          fact_value: string;
          id?: string;
          source_url?: string | null;
          workspace_id: string;
        };
        Update: {
          confidence?: number | null;
          created_at?: string | null;
          fact_key?: string;
          fact_type?: string;
          fact_value?: string;
          id?: string;
          source_url?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ground_truth_facts_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      house_rules: {
        Row: {
          active: boolean;
          category: string;
          created_at: string;
          id: string;
          rule_text: string;
          source: string;
          source_context: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          active?: boolean;
          category?: string;
          created_at?: string;
          id?: string;
          rule_text: string;
          source?: string;
          source_context?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          active?: boolean;
          category?: string;
          created_at?: string;
          id?: string;
          rule_text?: string;
          source?: string;
          source_context?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'house_rules_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      ignored_emails: {
        Row: {
          created_at: string | null;
          from_domain: string | null;
          id: string;
          ignore_reason: string | null;
          inbound_message_id: string | null;
          subject_pattern: string | null;
          workspace_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          from_domain?: string | null;
          id?: string;
          ignore_reason?: string | null;
          inbound_message_id?: string | null;
          subject_pattern?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          from_domain?: string | null;
          id?: string;
          ignore_reason?: string | null;
          inbound_message_id?: string | null;
          subject_pattern?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'ignored_emails_inbound_message_id_fkey';
            columns: ['inbound_message_id'];
            isOneToOne: false;
            referencedRelation: 'messages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ignored_emails_inbound_message_id_fkey';
            columns: ['inbound_message_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['inbound_id'];
          },
          {
            foreignKeyName: 'ignored_emails_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      image_analyses: {
        Row: {
          analysis_type: string;
          confidence: number | null;
          description: string | null;
          extracted_data: Json | null;
          id: string;
          image_url: string;
          message_id: string | null;
          processed_at: string | null;
          suggested_response: string | null;
          workspace_id: string;
        };
        Insert: {
          analysis_type: string;
          confidence?: number | null;
          description?: string | null;
          extracted_data?: Json | null;
          id?: string;
          image_url: string;
          message_id?: string | null;
          processed_at?: string | null;
          suggested_response?: string | null;
          workspace_id: string;
        };
        Update: {
          analysis_type?: string;
          confidence?: number | null;
          description?: string | null;
          extracted_data?: Json | null;
          id?: string;
          image_url?: string;
          message_id?: string | null;
          processed_at?: string | null;
          suggested_response?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'image_analyses_message_id_fkey';
            columns: ['message_id'];
            isOneToOne: false;
            referencedRelation: 'messages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'image_analyses_message_id_fkey';
            columns: ['message_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['inbound_id'];
          },
          {
            foreignKeyName: 'image_analyses_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      import_jobs: {
        Row: {
          completed_at: string | null;
          created_at: string | null;
          error_message: string | null;
          hydrating_completed_at: string | null;
          id: string;
          retry_count: number | null;
          scanning_completed_at: string | null;
          started_at: string | null;
          status: string | null;
          total_estimated: number | null;
          total_hydrated: number | null;
          total_processed: number | null;
          total_scanned: number | null;
          workspace_id: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string | null;
          error_message?: string | null;
          hydrating_completed_at?: string | null;
          id?: string;
          retry_count?: number | null;
          scanning_completed_at?: string | null;
          started_at?: string | null;
          status?: string | null;
          total_estimated?: number | null;
          total_hydrated?: number | null;
          total_processed?: number | null;
          total_scanned?: number | null;
          workspace_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string | null;
          error_message?: string | null;
          hydrating_completed_at?: string | null;
          id?: string;
          retry_count?: number | null;
          scanning_completed_at?: string | null;
          started_at?: string | null;
          status?: string | null;
          total_estimated?: number | null;
          total_hydrated?: number | null;
          total_processed?: number | null;
          total_scanned?: number | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'import_jobs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      import_progress: {
        Row: {
          completed_at: string | null;
          created_at: string;
          current_step: string | null;
          error: string | null;
          id: string;
          processed_emails: number | null;
          started_at: string | null;
          status: string;
          total_emails: number | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          current_step?: string | null;
          error?: string | null;
          id?: string;
          processed_emails?: number | null;
          started_at?: string | null;
          status?: string;
          total_emails?: number | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          current_step?: string | null;
          error?: string | null;
          id?: string;
          processed_emails?: number | null;
          started_at?: string | null;
          status?: string;
          total_emails?: number | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'import_progress_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      inbox_insights: {
        Row: {
          analyzed_at: string | null;
          avg_response_time_hours: number | null;
          common_inquiry_types: Json | null;
          created_at: string | null;
          emails_by_category: Json | null;
          emails_by_sender_domain: Json | null;
          id: string;
          learning_phases_completed: Json | null;
          patterns_learned: number | null;
          peak_email_hours: Json | null;
          response_rate_percent: number | null;
          total_emails_analyzed: number | null;
          total_outbound_analyzed: number | null;
          updated_at: string | null;
          workspace_id: string;
        };
        Insert: {
          analyzed_at?: string | null;
          avg_response_time_hours?: number | null;
          common_inquiry_types?: Json | null;
          created_at?: string | null;
          emails_by_category?: Json | null;
          emails_by_sender_domain?: Json | null;
          id?: string;
          learning_phases_completed?: Json | null;
          patterns_learned?: number | null;
          peak_email_hours?: Json | null;
          response_rate_percent?: number | null;
          total_emails_analyzed?: number | null;
          total_outbound_analyzed?: number | null;
          updated_at?: string | null;
          workspace_id: string;
        };
        Update: {
          analyzed_at?: string | null;
          avg_response_time_hours?: number | null;
          common_inquiry_types?: Json | null;
          created_at?: string | null;
          emails_by_category?: Json | null;
          emails_by_sender_domain?: Json | null;
          id?: string;
          learning_phases_completed?: Json | null;
          patterns_learned?: number | null;
          peak_email_hours?: Json | null;
          response_rate_percent?: number | null;
          total_emails_analyzed?: number | null;
          total_outbound_analyzed?: number | null;
          updated_at?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'inbox_insights_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      industry_faq_templates: {
        Row: {
          answer: string;
          category: string | null;
          created_at: string | null;
          embedding: string | null;
          id: string;
          industry_type: string;
          is_active: boolean | null;
          metadata: Json | null;
          question: string;
          tags: string[] | null;
          updated_at: string | null;
        };
        Insert: {
          answer: string;
          category?: string | null;
          created_at?: string | null;
          embedding?: string | null;
          id?: string;
          industry_type: string;
          is_active?: boolean | null;
          metadata?: Json | null;
          question: string;
          tags?: string[] | null;
          updated_at?: string | null;
        };
        Update: {
          answer?: string;
          category?: string | null;
          created_at?: string | null;
          embedding?: string | null;
          id?: string;
          industry_type?: string;
          is_active?: boolean | null;
          metadata?: Json | null;
          question?: string;
          tags?: string[] | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      knowledge_base_faqs: {
        Row: {
          answer: string;
          category: string | null;
          created_at: string | null;
          embedding: string | null;
          id: string;
          is_validated: boolean | null;
          priority: number | null;
          question: string;
          source: string;
          source_domain: string | null;
          source_url: string | null;
          updated_at: string | null;
          validation_notes: string | null;
          workspace_id: string;
        };
        Insert: {
          answer: string;
          category?: string | null;
          created_at?: string | null;
          embedding?: string | null;
          id?: string;
          is_validated?: boolean | null;
          priority?: number | null;
          question: string;
          source: string;
          source_domain?: string | null;
          source_url?: string | null;
          updated_at?: string | null;
          validation_notes?: string | null;
          workspace_id: string;
        };
        Update: {
          answer?: string;
          category?: string | null;
          created_at?: string | null;
          embedding?: string | null;
          id?: string;
          is_validated?: boolean | null;
          priority?: number | null;
          question?: string;
          source?: string;
          source_domain?: string | null;
          source_url?: string | null;
          updated_at?: string | null;
          validation_notes?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'knowledge_base_faqs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      known_senders: {
        Row: {
          category: string;
          created_at: string | null;
          id: string;
          is_global: boolean | null;
          pattern: string;
          pattern_type: string;
          requires_reply: boolean | null;
          workspace_id: string | null;
        };
        Insert: {
          category: string;
          created_at?: string | null;
          id?: string;
          is_global?: boolean | null;
          pattern: string;
          pattern_type: string;
          requires_reply?: boolean | null;
          workspace_id?: string | null;
        };
        Update: {
          category?: string;
          created_at?: string | null;
          id?: string;
          is_global?: boolean | null;
          pattern?: string;
          pattern_type?: string;
          requires_reply?: boolean | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'known_senders_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      lead_events: {
        Row: {
          channel: string | null;
          created_at: string | null;
          created_by: string | null;
          details: Json | null;
          event_type: string;
          id: string;
          lead_id: string | null;
        };
        Insert: {
          channel?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          details?: Json | null;
          event_type: string;
          id?: string;
          lead_id?: string | null;
        };
        Update: {
          channel?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          details?: Json | null;
          event_type?: string;
          id?: string;
          lead_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'lead_events_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
        ];
      };
      leads: {
        Row: {
          addons: Json | null;
          addons_total: number | null;
          address: string | null;
          bedrooms: string | null;
          build_type: string | null;
          chase_1_sent_at: string | null;
          chase_2_sent_at: string | null;
          chase_3_sent_at: string | null;
          chase_count: number | null;
          commercial_desc: string | null;
          commercial_type: string | null;
          confirmed_at: string | null;
          created_at: string | null;
          email: string | null;
          extras: Json | null;
          frequency: string | null;
          gocardless_billing_request_id: string | null;
          gocardless_link: string | null;
          id: string;
          last_chased_at: string | null;
          name: string | null;
          notes: string | null;
          payment_link: string | null;
          payment_method: string | null;
          phone: string | null;
          photo_urls: string[] | null;
          postcode: string | null;
          price_per_clean: number | null;
          property_type: string | null;
          quoted_at: string | null;
          referrer: string | null;
          signed_up_at: string | null;
          source_page: string | null;
          status: string | null;
          stripe_customer_id: string | null;
          updated_at: string | null;
          utm_campaign: string | null;
          utm_medium: string | null;
          utm_source: string | null;
        };
        Insert: {
          addons?: Json | null;
          addons_total?: number | null;
          address?: string | null;
          bedrooms?: string | null;
          build_type?: string | null;
          chase_1_sent_at?: string | null;
          chase_2_sent_at?: string | null;
          chase_3_sent_at?: string | null;
          chase_count?: number | null;
          commercial_desc?: string | null;
          commercial_type?: string | null;
          confirmed_at?: string | null;
          created_at?: string | null;
          email?: string | null;
          extras?: Json | null;
          frequency?: string | null;
          gocardless_billing_request_id?: string | null;
          gocardless_link?: string | null;
          id?: string;
          last_chased_at?: string | null;
          name?: string | null;
          notes?: string | null;
          payment_link?: string | null;
          payment_method?: string | null;
          phone?: string | null;
          photo_urls?: string[] | null;
          postcode?: string | null;
          price_per_clean?: number | null;
          property_type?: string | null;
          quoted_at?: string | null;
          referrer?: string | null;
          signed_up_at?: string | null;
          source_page?: string | null;
          status?: string | null;
          stripe_customer_id?: string | null;
          updated_at?: string | null;
          utm_campaign?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
        };
        Update: {
          addons?: Json | null;
          addons_total?: number | null;
          address?: string | null;
          bedrooms?: string | null;
          build_type?: string | null;
          chase_1_sent_at?: string | null;
          chase_2_sent_at?: string | null;
          chase_3_sent_at?: string | null;
          chase_count?: number | null;
          commercial_desc?: string | null;
          commercial_type?: string | null;
          confirmed_at?: string | null;
          created_at?: string | null;
          email?: string | null;
          extras?: Json | null;
          frequency?: string | null;
          gocardless_billing_request_id?: string | null;
          gocardless_link?: string | null;
          id?: string;
          last_chased_at?: string | null;
          name?: string | null;
          notes?: string | null;
          payment_link?: string | null;
          payment_method?: string | null;
          phone?: string | null;
          photo_urls?: string[] | null;
          postcode?: string | null;
          price_per_clean?: number | null;
          property_type?: string | null;
          quoted_at?: string | null;
          referrer?: string | null;
          signed_up_at?: string | null;
          source_page?: string | null;
          status?: string | null;
          stripe_customer_id?: string | null;
          updated_at?: string | null;
          utm_campaign?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
        };
        Relationships: [];
      };
      learned_responses: {
        Row: {
          created_at: string | null;
          email_category: string | null;
          example_response: string | null;
          id: string;
          response_pattern: string | null;
          success_indicators: Json | null;
          times_used: number | null;
          trigger_phrases: string[] | null;
          updated_at: string | null;
          workspace_id: string;
        };
        Insert: {
          created_at?: string | null;
          email_category?: string | null;
          example_response?: string | null;
          id?: string;
          response_pattern?: string | null;
          success_indicators?: Json | null;
          times_used?: number | null;
          trigger_phrases?: string[] | null;
          updated_at?: string | null;
          workspace_id: string;
        };
        Update: {
          created_at?: string | null;
          email_category?: string | null;
          example_response?: string | null;
          id?: string;
          response_pattern?: string | null;
          success_indicators?: Json | null;
          times_used?: number | null;
          trigger_phrases?: string[] | null;
          updated_at?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'learned_responses_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      make_progress: {
        Row: {
          completed_at: string | null;
          emails_classified: number | null;
          emails_imported: number | null;
          emails_total: number | null;
          error_message: string | null;
          started_at: string | null;
          status: string | null;
          updated_at: string | null;
          voice_profile_complete: boolean | null;
          workspace_id: string;
        };
        Insert: {
          completed_at?: string | null;
          emails_classified?: number | null;
          emails_imported?: number | null;
          emails_total?: number | null;
          error_message?: string | null;
          started_at?: string | null;
          status?: string | null;
          updated_at?: string | null;
          voice_profile_complete?: boolean | null;
          workspace_id: string;
        };
        Update: {
          completed_at?: string | null;
          emails_classified?: number | null;
          emails_imported?: number | null;
          emails_total?: number | null;
          error_message?: string | null;
          started_at?: string | null;
          status?: string | null;
          updated_at?: string | null;
          voice_profile_complete?: boolean | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'make_progress_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: true;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      message_events: {
        Row: {
          body: string | null;
          body_html: string | null;
          channel: string;
          config_id: string;
          created_at: string;
          direction: string;
          external_id: string;
          from_identifier: string;
          from_name: string | null;
          id: string;
          is_read: boolean;
          last_error: string | null;
          materialized_conversation_id: string | null;
          materialized_customer_id: string | null;
          materialized_message_id: string | null;
          metadata: Json;
          raw_payload: Json | null;
          run_id: string | null;
          status: string;
          subject: string | null;
          thread_id: string;
          timestamp: string;
          to_identifier: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          body?: string | null;
          body_html?: string | null;
          channel: string;
          config_id: string;
          created_at?: string;
          direction: string;
          external_id: string;
          from_identifier: string;
          from_name?: string | null;
          id?: string;
          is_read?: boolean;
          last_error?: string | null;
          materialized_conversation_id?: string | null;
          materialized_customer_id?: string | null;
          materialized_message_id?: string | null;
          metadata?: Json;
          raw_payload?: Json | null;
          run_id?: string | null;
          status?: string;
          subject?: string | null;
          thread_id: string;
          timestamp: string;
          to_identifier: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          body?: string | null;
          body_html?: string | null;
          channel?: string;
          config_id?: string;
          created_at?: string;
          direction?: string;
          external_id?: string;
          from_identifier?: string;
          from_name?: string | null;
          id?: string;
          is_read?: boolean;
          last_error?: string | null;
          materialized_conversation_id?: string | null;
          materialized_customer_id?: string | null;
          materialized_message_id?: string | null;
          metadata?: Json;
          raw_payload?: Json | null;
          run_id?: string | null;
          status?: string;
          subject?: string | null;
          thread_id?: string;
          timestamp?: string;
          to_identifier?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'message_events_materialized_conversation_id_fkey';
            columns: ['materialized_conversation_id'];
            isOneToOne: false;
            referencedRelation: 'bb_needs_classification';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'message_events_materialized_conversation_id_fkey';
            columns: ['materialized_conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'message_events_materialized_conversation_id_fkey';
            columns: ['materialized_conversation_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'message_events_materialized_customer_id_fkey';
            columns: ['materialized_customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'message_events_materialized_message_id_fkey';
            columns: ['materialized_message_id'];
            isOneToOne: false;
            referencedRelation: 'messages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'message_events_materialized_message_id_fkey';
            columns: ['materialized_message_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['inbound_id'];
          },
          {
            foreignKeyName: 'message_events_run_id_fkey';
            columns: ['run_id'];
            isOneToOne: false;
            referencedRelation: 'bb_pipeline_progress';
            referencedColumns: ['run_id'];
          },
          {
            foreignKeyName: 'message_events_run_id_fkey';
            columns: ['run_id'];
            isOneToOne: false;
            referencedRelation: 'pipeline_runs';
            referencedColumns: ['id'];
          },
        ];
      };
      message_responses: {
        Row: {
          agent_id: string | null;
          created_at: string | null;
          id: string;
          message_id: string;
          response_content: string;
          sent_to_n8n: boolean | null;
        };
        Insert: {
          agent_id?: string | null;
          created_at?: string | null;
          id?: string;
          message_id: string;
          response_content: string;
          sent_to_n8n?: boolean | null;
        };
        Update: {
          agent_id?: string | null;
          created_at?: string | null;
          id?: string;
          message_id?: string;
          response_content?: string;
          sent_to_n8n?: boolean | null;
        };
        Relationships: [
          {
            foreignKeyName: 'message_responses_agent_id_fkey';
            columns: ['agent_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'message_responses_message_id_fkey';
            columns: ['message_id'];
            isOneToOne: false;
            referencedRelation: 'escalated_messages';
            referencedColumns: ['id'];
          },
        ];
      };
      messages: {
        Row: {
          actor_id: string | null;
          actor_name: string | null;
          actor_type: string;
          attachments: Json | null;
          body: string;
          channel: string;
          config_id: string | null;
          conversation_id: string | null;
          created_at: string | null;
          direction: string;
          external_id: string | null;
          external_thread_id: string | null;
          id: string;
          is_internal: boolean | null;
          raw_payload: Json | null;
        };
        Insert: {
          actor_id?: string | null;
          actor_name?: string | null;
          actor_type: string;
          attachments?: Json | null;
          body: string;
          channel: string;
          config_id?: string | null;
          conversation_id?: string | null;
          created_at?: string | null;
          direction: string;
          external_id?: string | null;
          external_thread_id?: string | null;
          id?: string;
          is_internal?: boolean | null;
          raw_payload?: Json | null;
        };
        Update: {
          actor_id?: string | null;
          actor_name?: string | null;
          actor_type?: string;
          attachments?: Json | null;
          body?: string;
          channel?: string;
          config_id?: string | null;
          conversation_id?: string | null;
          created_at?: string | null;
          direction?: string;
          external_id?: string | null;
          external_thread_id?: string | null;
          id?: string;
          is_internal?: boolean | null;
          raw_payload?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: 'messages_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'bb_needs_classification';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'messages_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'messages_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['conversation_id'];
          },
        ];
      };
      meta_provider_configs: {
        Row: {
          connected_at: string;
          encrypted_page_access_token: string;
          id: string;
          instagram_account_id: string | null;
          instagram_username: string | null;
          meta_user_id: string | null;
          page_id: string;
          page_name: string | null;
          status: string;
          token_expires_at: string | null;
          workspace_id: string;
        };
        Insert: {
          connected_at?: string;
          encrypted_page_access_token: string;
          id?: string;
          instagram_account_id?: string | null;
          instagram_username?: string | null;
          meta_user_id?: string | null;
          page_id: string;
          page_name?: string | null;
          status?: string;
          token_expires_at?: string | null;
          workspace_id: string;
        };
        Update: {
          connected_at?: string;
          encrypted_page_access_token?: string;
          id?: string;
          instagram_account_id?: string | null;
          instagram_username?: string | null;
          meta_user_id?: string | null;
          page_id?: string;
          page_name?: string | null;
          status?: string;
          token_expires_at?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'meta_provider_configs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      n8n_workflow_progress: {
        Row: {
          completed_at: string | null;
          created_at: string | null;
          details: Json | null;
          id: string;
          started_at: string | null;
          status: string;
          updated_at: string | null;
          workflow_type: string;
          workspace_id: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string | null;
          details?: Json | null;
          id?: string;
          started_at?: string | null;
          status?: string;
          updated_at?: string | null;
          workflow_type: string;
          workspace_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string | null;
          details?: Json | null;
          id?: string;
          started_at?: string | null;
          status?: string;
          updated_at?: string | null;
          workflow_type?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'n8n_workflow_progress_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      notification_preferences: {
        Row: {
          created_at: string | null;
          id: string;
          summary_channels: string[] | null;
          summary_email: string | null;
          summary_enabled: boolean | null;
          summary_phone: string | null;
          summary_times: string[] | null;
          timezone: string | null;
          updated_at: string | null;
          workspace_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          summary_channels?: string[] | null;
          summary_email?: string | null;
          summary_enabled?: boolean | null;
          summary_phone?: string | null;
          summary_times?: string[] | null;
          timezone?: string | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          summary_channels?: string[] | null;
          summary_email?: string | null;
          summary_enabled?: boolean | null;
          summary_phone?: string | null;
          summary_times?: string[] | null;
          timezone?: string | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_preferences_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: true;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      notifications: {
        Row: {
          body: string;
          created_at: string | null;
          id: string;
          is_read: boolean | null;
          metadata: Json | null;
          title: string;
          type: string;
          user_id: string | null;
          workspace_id: string | null;
        };
        Insert: {
          body: string;
          created_at?: string | null;
          id?: string;
          is_read?: boolean | null;
          metadata?: Json | null;
          title: string;
          type?: string;
          user_id?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          body?: string;
          created_at?: string | null;
          id?: string;
          is_read?: boolean | null;
          metadata?: Json | null;
          title?: string;
          type?: string;
          user_id?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notifications_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      onboarding_progress: {
        Row: {
          avg_response_time_hours: number | null;
          categorization_progress: number | null;
          categorization_status: string | null;
          completed_at: string | null;
          created_at: string | null;
          email_import_count: number | null;
          email_import_progress: number | null;
          email_import_status: string | null;
          estimated_completion_at: string | null;
          few_shot_status: string | null;
          id: string;
          ignored_email_count: number | null;
          pairs_categorized: number | null;
          pairs_matched: number | null;
          response_rate_percent: number | null;
          started_at: string | null;
          style_analysis_status: string | null;
          thread_matching_progress: number | null;
          thread_matching_status: string | null;
          top_categories: Json | null;
          updated_at: string | null;
          workspace_id: string | null;
        };
        Insert: {
          avg_response_time_hours?: number | null;
          categorization_progress?: number | null;
          categorization_status?: string | null;
          completed_at?: string | null;
          created_at?: string | null;
          email_import_count?: number | null;
          email_import_progress?: number | null;
          email_import_status?: string | null;
          estimated_completion_at?: string | null;
          few_shot_status?: string | null;
          id?: string;
          ignored_email_count?: number | null;
          pairs_categorized?: number | null;
          pairs_matched?: number | null;
          response_rate_percent?: number | null;
          started_at?: string | null;
          style_analysis_status?: string | null;
          thread_matching_progress?: number | null;
          thread_matching_status?: string | null;
          top_categories?: Json | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          avg_response_time_hours?: number | null;
          categorization_progress?: number | null;
          categorization_status?: string | null;
          completed_at?: string | null;
          created_at?: string | null;
          email_import_count?: number | null;
          email_import_progress?: number | null;
          email_import_status?: string | null;
          estimated_completion_at?: string | null;
          few_shot_status?: string | null;
          id?: string;
          ignored_email_count?: number | null;
          pairs_categorized?: number | null;
          pairs_matched?: number | null;
          response_rate_percent?: number | null;
          started_at?: string | null;
          style_analysis_status?: string | null;
          thread_matching_progress?: number | null;
          thread_matching_status?: string | null;
          top_categories?: Json | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'onboarding_progress_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: true;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      pipeline_errors: {
        Row: {
          context: Json | null;
          created_at: string | null;
          error: string | null;
          id: string;
          run_id: string | null;
          scope: string | null;
          severity: string | null;
          workspace_id: string | null;
        };
        Insert: {
          context?: Json | null;
          created_at?: string | null;
          error?: string | null;
          id?: string;
          run_id?: string | null;
          scope?: string | null;
          severity?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          context?: Json | null;
          created_at?: string | null;
          error?: string | null;
          id?: string;
          run_id?: string | null;
          scope?: string | null;
          severity?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [];
      };
      pipeline_incidents: {
        Row: {
          context: Json;
          created_at: string;
          error: string;
          id: string;
          resolved_at: string | null;
          run_id: string | null;
          scope: string;
          severity: string;
          workspace_id: string;
        };
        Insert: {
          context?: Json;
          created_at?: string;
          error: string;
          id?: string;
          resolved_at?: string | null;
          run_id?: string | null;
          scope: string;
          severity: string;
          workspace_id: string;
        };
        Update: {
          context?: Json;
          created_at?: string;
          error?: string;
          id?: string;
          resolved_at?: string | null;
          run_id?: string | null;
          scope?: string;
          severity?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pipeline_incidents_run_id_fkey';
            columns: ['run_id'];
            isOneToOne: false;
            referencedRelation: 'bb_pipeline_progress';
            referencedColumns: ['run_id'];
          },
          {
            foreignKeyName: 'pipeline_incidents_run_id_fkey';
            columns: ['run_id'];
            isOneToOne: false;
            referencedRelation: 'pipeline_runs';
            referencedColumns: ['id'];
          },
        ];
      };
      pipeline_job_audit: {
        Row: {
          attempts: number;
          created_at: string;
          error: string | null;
          id: string;
          job_payload: Json;
          outcome: string;
          queue_name: string;
          run_id: string | null;
          workspace_id: string | null;
        };
        Insert: {
          attempts?: number;
          created_at?: string;
          error?: string | null;
          id?: string;
          job_payload: Json;
          outcome: string;
          queue_name: string;
          run_id?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          error?: string | null;
          id?: string;
          job_payload?: Json;
          outcome?: string;
          queue_name?: string;
          run_id?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'pipeline_job_audit_run_id_fkey';
            columns: ['run_id'];
            isOneToOne: false;
            referencedRelation: 'bb_pipeline_progress';
            referencedColumns: ['run_id'];
          },
          {
            foreignKeyName: 'pipeline_job_audit_run_id_fkey';
            columns: ['run_id'];
            isOneToOne: false;
            referencedRelation: 'pipeline_runs';
            referencedColumns: ['id'];
          },
        ];
      };
      pipeline_locks: {
        Row: {
          function_name: string;
          id: string;
          locked_at: string;
          locked_by: string | null;
          workspace_id: string;
        };
        Insert: {
          function_name: string;
          id?: string;
          locked_at?: string;
          locked_by?: string | null;
          workspace_id: string;
        };
        Update: {
          function_name?: string;
          id?: string;
          locked_at?: string;
          locked_by?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pipeline_locks_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      pipeline_run_logs: {
        Row: {
          context: Json | null;
          created_at: string | null;
          id: string;
          level: string | null;
          message: string | null;
          run_id: string | null;
        };
        Insert: {
          context?: Json | null;
          created_at?: string | null;
          id?: string;
          level?: string | null;
          message?: string | null;
          run_id?: string | null;
        };
        Update: {
          context?: Json | null;
          created_at?: string | null;
          id?: string;
          level?: string | null;
          message?: string | null;
          run_id?: string | null;
        };
        Relationships: [];
      };
      pipeline_runs: {
        Row: {
          channel: string;
          completed_at: string | null;
          config_id: string | null;
          created_at: string;
          id: string;
          last_error: string | null;
          last_heartbeat_at: string;
          metrics: Json;
          mode: string;
          params: Json;
          started_at: string;
          state: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          channel: string;
          completed_at?: string | null;
          config_id?: string | null;
          created_at?: string;
          id?: string;
          last_error?: string | null;
          last_heartbeat_at?: string;
          metrics?: Json;
          mode: string;
          params?: Json;
          started_at?: string;
          state?: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          channel?: string;
          completed_at?: string | null;
          config_id?: string | null;
          created_at?: string;
          id?: string;
          last_error?: string | null;
          last_heartbeat_at?: string;
          metrics?: Json;
          mode?: string;
          params?: Json;
          started_at?: string;
          state?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [];
      };
      pre_triage_rules: {
        Row: {
          action: string;
          created_at: string | null;
          id: string;
          is_active: boolean | null;
          pattern: string | null;
          priority: number | null;
          rule_name: string;
          rule_type: string;
          updated_at: string | null;
          workspace_id: string;
        };
        Insert: {
          action?: string;
          created_at?: string | null;
          id?: string;
          is_active?: boolean | null;
          pattern?: string | null;
          priority?: number | null;
          rule_name: string;
          rule_type?: string;
          updated_at?: string | null;
          workspace_id: string;
        };
        Update: {
          action?: string;
          created_at?: string | null;
          id?: string;
          is_active?: boolean | null;
          pattern?: string | null;
          priority?: number | null;
          rule_name?: string;
          rule_type?: string;
          updated_at?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pre_triage_rules_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      price_list: {
        Row: {
          affects_package: boolean | null;
          applies_to_properties: string[] | null;
          base_price: number | null;
          bedrooms: string | null;
          category: string | null;
          created_at: string | null;
          currency: string | null;
          customer_count: number | null;
          description: string | null;
          external_id: number | null;
          id: string;
          is_active: boolean | null;
          metadata: Json | null;
          per_unit: boolean | null;
          price_max: number | null;
          price_min: number | null;
          price_range: string | null;
          price_typical: number | null;
          property_type: string | null;
          rule_priority: number | null;
          service_code: string | null;
          service_name: string;
          unit: string | null;
          updated_at: string | null;
          window_price_max: number | null;
          window_price_min: number | null;
          workspace_id: string | null;
        };
        Insert: {
          affects_package?: boolean | null;
          applies_to_properties?: string[] | null;
          base_price?: number | null;
          bedrooms?: string | null;
          category?: string | null;
          created_at?: string | null;
          currency?: string | null;
          customer_count?: number | null;
          description?: string | null;
          external_id?: number | null;
          id?: string;
          is_active?: boolean | null;
          metadata?: Json | null;
          per_unit?: boolean | null;
          price_max?: number | null;
          price_min?: number | null;
          price_range?: string | null;
          price_typical?: number | null;
          property_type?: string | null;
          rule_priority?: number | null;
          service_code?: string | null;
          service_name: string;
          unit?: string | null;
          updated_at?: string | null;
          window_price_max?: number | null;
          window_price_min?: number | null;
          workspace_id?: string | null;
        };
        Update: {
          affects_package?: boolean | null;
          applies_to_properties?: string[] | null;
          base_price?: number | null;
          bedrooms?: string | null;
          category?: string | null;
          created_at?: string | null;
          currency?: string | null;
          customer_count?: number | null;
          description?: string | null;
          external_id?: number | null;
          id?: string;
          is_active?: boolean | null;
          metadata?: Json | null;
          per_unit?: boolean | null;
          price_max?: number | null;
          price_min?: number | null;
          price_range?: string | null;
          price_typical?: number | null;
          property_type?: string | null;
          rule_priority?: number | null;
          service_code?: string | null;
          service_name?: string;
          unit?: string | null;
          updated_at?: string | null;
          window_price_max?: number | null;
          window_price_min?: number | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'price_list_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      raw_emails: {
        Row: {
          body_html: string | null;
          body_text: string | null;
          classification: Json | null;
          classification_category: string | null;
          classification_confidence: number | null;
          classification_reasoning: string | null;
          confidence: number | null;
          created_at: string | null;
          email_type: string | null;
          error_message: string | null;
          external_id: string;
          folder: string | null;
          from_email: string;
          from_name: string | null;
          has_attachments: boolean | null;
          id: string;
          lane: string | null;
          processed: boolean | null;
          processing_completed_at: string | null;
          processing_started_at: string | null;
          received_at: string | null;
          requires_reply: boolean | null;
          retry_count: number | null;
          status: string | null;
          subject: string | null;
          thread_id: string | null;
          to_email: string | null;
          to_name: string | null;
          workspace_id: string;
        };
        Insert: {
          body_html?: string | null;
          body_text?: string | null;
          classification?: Json | null;
          classification_category?: string | null;
          classification_confidence?: number | null;
          classification_reasoning?: string | null;
          confidence?: number | null;
          created_at?: string | null;
          email_type?: string | null;
          error_message?: string | null;
          external_id: string;
          folder?: string | null;
          from_email: string;
          from_name?: string | null;
          has_attachments?: boolean | null;
          id?: string;
          lane?: string | null;
          processed?: boolean | null;
          processing_completed_at?: string | null;
          processing_started_at?: string | null;
          received_at?: string | null;
          requires_reply?: boolean | null;
          retry_count?: number | null;
          status?: string | null;
          subject?: string | null;
          thread_id?: string | null;
          to_email?: string | null;
          to_name?: string | null;
          workspace_id: string;
        };
        Update: {
          body_html?: string | null;
          body_text?: string | null;
          classification?: Json | null;
          classification_category?: string | null;
          classification_confidence?: number | null;
          classification_reasoning?: string | null;
          confidence?: number | null;
          created_at?: string | null;
          email_type?: string | null;
          error_message?: string | null;
          external_id?: string;
          folder?: string | null;
          from_email?: string;
          from_name?: string | null;
          has_attachments?: boolean | null;
          id?: string;
          lane?: string | null;
          processed?: boolean | null;
          processing_completed_at?: string | null;
          processing_started_at?: string | null;
          received_at?: string | null;
          requires_reply?: boolean | null;
          retry_count?: number | null;
          status?: string | null;
          subject?: string | null;
          thread_id?: string | null;
          to_email?: string | null;
          to_name?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'raw_emails_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      response_feedback: {
        Row: {
          ai_confidence: number | null;
          ai_draft: string | null;
          conversation_id: string | null;
          created_at: string | null;
          edit_distance: number | null;
          final_response: string | null;
          id: string;
          message_id: string | null;
          scenario_type: string | null;
          was_edited: boolean | null;
          workspace_id: string | null;
        };
        Insert: {
          ai_confidence?: number | null;
          ai_draft?: string | null;
          conversation_id?: string | null;
          created_at?: string | null;
          edit_distance?: number | null;
          final_response?: string | null;
          id?: string;
          message_id?: string | null;
          scenario_type?: string | null;
          was_edited?: boolean | null;
          workspace_id?: string | null;
        };
        Update: {
          ai_confidence?: number | null;
          ai_draft?: string | null;
          conversation_id?: string | null;
          created_at?: string | null;
          edit_distance?: number | null;
          final_response?: string | null;
          id?: string;
          message_id?: string | null;
          scenario_type?: string | null;
          was_edited?: boolean | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'response_feedback_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'bb_needs_classification';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'response_feedback_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'response_feedback_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'response_feedback_message_id_fkey';
            columns: ['message_id'];
            isOneToOne: false;
            referencedRelation: 'messages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'response_feedback_message_id_fkey';
            columns: ['message_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['inbound_id'];
          },
          {
            foreignKeyName: 'response_feedback_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      response_playbook: {
        Row: {
          decision_patterns: Json | null;
          id: string;
          playbook: Json;
          timing_patterns: Json | null;
          updated_at: string | null;
          workspace_id: string;
        };
        Insert: {
          decision_patterns?: Json | null;
          id?: string;
          playbook: Json;
          timing_patterns?: Json | null;
          updated_at?: string | null;
          workspace_id: string;
        };
        Update: {
          decision_patterns?: Json | null;
          id?: string;
          playbook?: Json;
          timing_patterns?: Json | null;
          updated_at?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'response_playbook_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: true;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      scraped_pages: {
        Row: {
          content_length: number | null;
          content_markdown: string | null;
          created_at: string | null;
          faqs_extracted: number | null;
          id: string;
          job_id: string;
          page_type: string | null;
          status: string | null;
          title: string | null;
          url: string;
          workspace_id: string;
        };
        Insert: {
          content_length?: number | null;
          content_markdown?: string | null;
          created_at?: string | null;
          faqs_extracted?: number | null;
          id?: string;
          job_id: string;
          page_type?: string | null;
          status?: string | null;
          title?: string | null;
          url: string;
          workspace_id: string;
        };
        Update: {
          content_length?: number | null;
          content_markdown?: string | null;
          created_at?: string | null;
          faqs_extracted?: number | null;
          id?: string;
          job_id?: string;
          page_type?: string | null;
          status?: string | null;
          title?: string | null;
          url?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'scraped_pages_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'scraping_jobs';
            referencedColumns: ['id'];
          },
        ];
      };
      scraping_jobs: {
        Row: {
          apify_dataset_id: string | null;
          apify_run_id: string | null;
          completed_at: string | null;
          created_at: string | null;
          error_message: string | null;
          faqs_found: number | null;
          faqs_stored: number | null;
          id: string;
          job_type: string;
          pages_processed: number | null;
          started_at: string | null;
          status: string | null;
          total_pages_found: number | null;
          website_url: string | null;
          workspace_id: string;
        };
        Insert: {
          apify_dataset_id?: string | null;
          apify_run_id?: string | null;
          completed_at?: string | null;
          created_at?: string | null;
          error_message?: string | null;
          faqs_found?: number | null;
          faqs_stored?: number | null;
          id?: string;
          job_type?: string;
          pages_processed?: number | null;
          started_at?: string | null;
          status?: string | null;
          total_pages_found?: number | null;
          website_url?: string | null;
          workspace_id: string;
        };
        Update: {
          apify_dataset_id?: string | null;
          apify_run_id?: string | null;
          completed_at?: string | null;
          created_at?: string | null;
          error_message?: string | null;
          faqs_found?: number | null;
          faqs_stored?: number | null;
          id?: string;
          job_type?: string;
          pages_processed?: number | null;
          started_at?: string | null;
          status?: string | null;
          total_pages_found?: number | null;
          website_url?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'scraping_jobs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      security_incidents: {
        Row: {
          affected_customers: Json | null;
          affected_records_count: number | null;
          created_at: string | null;
          description: string | null;
          detected_at: string | null;
          id: string;
          incident_type: string;
          notification_sent_at: string | null;
          remediation_steps: string | null;
          reported_at: string | null;
          reported_by: string | null;
          resolved_at: string | null;
          severity: string | null;
          status: string | null;
          updated_at: string | null;
          workspace_id: string | null;
        };
        Insert: {
          affected_customers?: Json | null;
          affected_records_count?: number | null;
          created_at?: string | null;
          description?: string | null;
          detected_at?: string | null;
          id?: string;
          incident_type: string;
          notification_sent_at?: string | null;
          remediation_steps?: string | null;
          reported_at?: string | null;
          reported_by?: string | null;
          resolved_at?: string | null;
          severity?: string | null;
          status?: string | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          affected_customers?: Json | null;
          affected_records_count?: number | null;
          created_at?: string | null;
          description?: string | null;
          detected_at?: string | null;
          id?: string;
          incident_type?: string;
          notification_sent_at?: string | null;
          remediation_steps?: string | null;
          reported_at?: string | null;
          reported_by?: string | null;
          resolved_at?: string | null;
          severity?: string | null;
          status?: string | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'security_incidents_reported_by_fkey';
            columns: ['reported_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'security_incidents_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      sender_behaviour_stats: {
        Row: {
          avg_response_time_minutes: number | null;
          created_at: string | null;
          id: string;
          ignored_count: number | null;
          ignored_rate: number | null;
          last_interaction_at: string | null;
          replied_count: number | null;
          reply_rate: number | null;
          sender_domain: string | null;
          sender_email: string;
          total_messages: number | null;
          updated_at: string | null;
          vip_score: number | null;
          workspace_id: string | null;
        };
        Insert: {
          avg_response_time_minutes?: number | null;
          created_at?: string | null;
          id?: string;
          ignored_count?: number | null;
          ignored_rate?: number | null;
          last_interaction_at?: string | null;
          replied_count?: number | null;
          reply_rate?: number | null;
          sender_domain?: string | null;
          sender_email: string;
          total_messages?: number | null;
          updated_at?: string | null;
          vip_score?: number | null;
          workspace_id?: string | null;
        };
        Update: {
          avg_response_time_minutes?: number | null;
          created_at?: string | null;
          id?: string;
          ignored_count?: number | null;
          ignored_rate?: number | null;
          last_interaction_at?: string | null;
          replied_count?: number | null;
          reply_rate?: number | null;
          sender_domain?: string | null;
          sender_email?: string;
          total_messages?: number | null;
          updated_at?: string | null;
          vip_score?: number | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'sender_behaviour_stats_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      sender_rules: {
        Row: {
          automation_level: string | null;
          confidence_adjustment: number | null;
          created_at: string | null;
          created_from_correction: string | null;
          default_classification: string;
          default_lane: string | null;
          default_requires_reply: boolean | null;
          hit_count: number | null;
          id: string;
          is_active: boolean | null;
          override_classification: string | null;
          override_keywords: string[] | null;
          override_requires_reply: boolean | null;
          sender_pattern: string;
          skip_llm: boolean | null;
          tone_preference: string | null;
          updated_at: string | null;
          workspace_id: string | null;
        };
        Insert: {
          automation_level?: string | null;
          confidence_adjustment?: number | null;
          created_at?: string | null;
          created_from_correction?: string | null;
          default_classification: string;
          default_lane?: string | null;
          default_requires_reply?: boolean | null;
          hit_count?: number | null;
          id?: string;
          is_active?: boolean | null;
          override_classification?: string | null;
          override_keywords?: string[] | null;
          override_requires_reply?: boolean | null;
          sender_pattern: string;
          skip_llm?: boolean | null;
          tone_preference?: string | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          automation_level?: string | null;
          confidence_adjustment?: number | null;
          created_at?: string | null;
          created_from_correction?: string | null;
          default_classification?: string;
          default_lane?: string | null;
          default_requires_reply?: boolean | null;
          hit_count?: number | null;
          id?: string;
          is_active?: boolean | null;
          override_classification?: string | null;
          override_keywords?: string[] | null;
          override_requires_reply?: boolean | null;
          sender_pattern?: string;
          skip_llm?: boolean | null;
          tone_preference?: string | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'sender_rules_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      sla_configs: {
        Row: {
          first_response_minutes: number;
          id: string;
          pause_outside_hours: boolean | null;
          priority: string;
          workspace_id: string | null;
        };
        Insert: {
          first_response_minutes: number;
          id?: string;
          pause_outside_hours?: boolean | null;
          priority: string;
          workspace_id?: string | null;
        };
        Update: {
          first_response_minutes?: number;
          id?: string;
          pause_outside_hours?: boolean | null;
          priority?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'sla_configs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      sync_logs: {
        Row: {
          completed_at: string | null;
          details: Json | null;
          error_message: string | null;
          id: string;
          records_fetched: number | null;
          records_inserted: number | null;
          records_unchanged: number | null;
          records_updated: number | null;
          started_at: string | null;
          status: string | null;
          sync_type: string;
          tables_synced: string[];
          workspace_id: string | null;
        };
        Insert: {
          completed_at?: string | null;
          details?: Json | null;
          error_message?: string | null;
          id?: string;
          records_fetched?: number | null;
          records_inserted?: number | null;
          records_unchanged?: number | null;
          records_updated?: number | null;
          started_at?: string | null;
          status?: string | null;
          sync_type: string;
          tables_synced: string[];
          workspace_id?: string | null;
        };
        Update: {
          completed_at?: string | null;
          details?: Json | null;
          error_message?: string | null;
          id?: string;
          records_fetched?: number | null;
          records_inserted?: number | null;
          records_unchanged?: number | null;
          records_updated?: number | null;
          started_at?: string | null;
          status?: string | null;
          sync_type?: string;
          tables_synced?: string[];
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'sync_logs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      system_logs: {
        Row: {
          created_at: string | null;
          details: Json | null;
          function_name: string | null;
          id: string;
          level: string;
          message: string;
          stack_trace: string | null;
          workspace_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          details?: Json | null;
          function_name?: string | null;
          id?: string;
          level?: string;
          message: string;
          stack_trace?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          details?: Json | null;
          function_name?: string | null;
          id?: string;
          level?: string;
          message?: string;
          stack_trace?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'system_logs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      system_prompts: {
        Row: {
          agent_type: string;
          created_at: string;
          id: string;
          is_active: boolean | null;
          is_default: boolean | null;
          model: string | null;
          name: string;
          prompt: string;
          updated_at: string;
          workspace_id: string | null;
        };
        Insert: {
          agent_type: string;
          created_at?: string;
          id?: string;
          is_active?: boolean | null;
          is_default?: boolean | null;
          model?: string | null;
          name: string;
          prompt: string;
          updated_at?: string;
          workspace_id?: string | null;
        };
        Update: {
          agent_type?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean | null;
          is_default?: boolean | null;
          model?: string | null;
          name?: string;
          prompt?: string;
          updated_at?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'system_prompts_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      templates: {
        Row: {
          body: string;
          category: string | null;
          created_at: string | null;
          id: string;
          name: string;
          usage_count: number | null;
          workspace_id: string | null;
        };
        Insert: {
          body: string;
          category?: string | null;
          created_at?: string | null;
          id?: string;
          name: string;
          usage_count?: number | null;
          workspace_id?: string | null;
        };
        Update: {
          body?: string;
          category?: string | null;
          created_at?: string | null;
          id?: string;
          name?: string;
          usage_count?: number | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'templates_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      triage_corrections: {
        Row: {
          conversation_id: string | null;
          corrected_at: string | null;
          corrected_by: string | null;
          created_at: string | null;
          id: string;
          new_classification: string | null;
          new_requires_reply: boolean | null;
          original_classification: string | null;
          original_requires_reply: boolean | null;
          sender_domain: string | null;
          sender_email: string | null;
          subject_keywords: string[] | null;
          workspace_id: string | null;
        };
        Insert: {
          conversation_id?: string | null;
          corrected_at?: string | null;
          corrected_by?: string | null;
          created_at?: string | null;
          id?: string;
          new_classification?: string | null;
          new_requires_reply?: boolean | null;
          original_classification?: string | null;
          original_requires_reply?: boolean | null;
          sender_domain?: string | null;
          sender_email?: string | null;
          subject_keywords?: string[] | null;
          workspace_id?: string | null;
        };
        Update: {
          conversation_id?: string | null;
          corrected_at?: string | null;
          corrected_by?: string | null;
          created_at?: string | null;
          id?: string;
          new_classification?: string | null;
          new_requires_reply?: boolean | null;
          original_classification?: string | null;
          original_requires_reply?: boolean | null;
          sender_domain?: string | null;
          sender_email?: string | null;
          subject_keywords?: string[] | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'triage_corrections_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'bb_needs_classification';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'triage_corrections_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'triage_corrections_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'triage_corrections_corrected_by_fkey';
            columns: ['corrected_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'triage_corrections_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      user_roles: {
        Row: {
          id: string;
          role: Database['public']['Enums']['app_role'];
          user_id: string;
        };
        Insert: {
          id?: string;
          role: Database['public']['Enums']['app_role'];
          user_id: string;
        };
        Update: {
          id?: string;
          role?: Database['public']['Enums']['app_role'];
          user_id?: string;
        };
        Relationships: [];
      };
      users: {
        Row: {
          created_at: string | null;
          email: string;
          id: string;
          interface_mode: string | null;
          is_online: boolean | null;
          last_active_at: string | null;
          name: string;
          onboarding_completed: boolean | null;
          onboarding_step: string | null;
          status: string | null;
          updated_at: string | null;
          workspace_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          email: string;
          id: string;
          interface_mode?: string | null;
          is_online?: boolean | null;
          last_active_at?: string | null;
          name: string;
          onboarding_completed?: boolean | null;
          onboarding_step?: string | null;
          status?: string | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          email?: string;
          id?: string;
          interface_mode?: string | null;
          is_online?: boolean | null;
          last_active_at?: string | null;
          name?: string;
          onboarding_completed?: boolean | null;
          onboarding_step?: string | null;
          status?: string | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'users_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      voice_drift_log: {
        Row: {
          checked_at: string;
          drift_score: number;
          emails_sampled: number | null;
          id: string;
          refresh_triggered: boolean;
          status: string;
          traits_changed: Json | null;
          workspace_id: string;
        };
        Insert: {
          checked_at?: string;
          drift_score?: number;
          emails_sampled?: number | null;
          id?: string;
          refresh_triggered?: boolean;
          status?: string;
          traits_changed?: Json | null;
          workspace_id: string;
        };
        Update: {
          checked_at?: string;
          drift_score?: number;
          emails_sampled?: number | null;
          id?: string;
          refresh_triggered?: boolean;
          status?: string;
          traits_changed?: Json | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'voice_drift_log_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      voice_profiles: {
        Row: {
          analysis_status: string | null;
          average_length: number | null;
          avg_response_length: number | null;
          avg_response_time_minutes: number | null;
          avg_sentences: number | null;
          avg_words_per_sentence: number | null;
          avoided_words: string[] | null;
          booking_confirmation_style: string | null;
          channel_adjustments: Json | null;
          closing_style: string | null;
          common_phrases: Json | null;
          created_at: string | null;
          directness_level: number | null;
          emails_analyzed: number | null;
          emoji_frequency: string | null;
          example_responses: Json | null;
          examples: Json | null;
          examples_count: number | null;
          exclamation_frequency: number | null;
          formality_level: number | null;
          formality_score: number | null;
          greeting_patterns: Json | null;
          greeting_style: string | null;
          id: string;
          ignore_patterns: Json | null;
          last_analyzed_at: string | null;
          learnings: string[] | null;
          objection_handling_style: string | null;
          outbound_emails_found: number | null;
          personality_traits: Json | null;
          price_mention_style: string | null;
          psychological_profile: Json | null;
          reply_triggers: Json | null;
          response_patterns: Json | null;
          response_rate_percent: number | null;
          sample_count: number | null;
          sample_responses: Json | null;
          signoff_patterns: Json | null;
          signoff_style: string | null;
          style_confidence: number | null;
          style_summary: string | null;
          tone: string | null;
          tone_descriptors: string[] | null;
          total_pairs_analyzed: number | null;
          updated_at: string | null;
          uses_emojis: boolean | null;
          uses_exclamations: boolean | null;
          warmth_level: number | null;
          workspace_id: string | null;
        };
        Insert: {
          analysis_status?: string | null;
          average_length?: number | null;
          avg_response_length?: number | null;
          avg_response_time_minutes?: number | null;
          avg_sentences?: number | null;
          avg_words_per_sentence?: number | null;
          avoided_words?: string[] | null;
          booking_confirmation_style?: string | null;
          channel_adjustments?: Json | null;
          closing_style?: string | null;
          common_phrases?: Json | null;
          created_at?: string | null;
          directness_level?: number | null;
          emails_analyzed?: number | null;
          emoji_frequency?: string | null;
          example_responses?: Json | null;
          examples?: Json | null;
          examples_count?: number | null;
          exclamation_frequency?: number | null;
          formality_level?: number | null;
          formality_score?: number | null;
          greeting_patterns?: Json | null;
          greeting_style?: string | null;
          id?: string;
          ignore_patterns?: Json | null;
          last_analyzed_at?: string | null;
          learnings?: string[] | null;
          objection_handling_style?: string | null;
          outbound_emails_found?: number | null;
          personality_traits?: Json | null;
          price_mention_style?: string | null;
          psychological_profile?: Json | null;
          reply_triggers?: Json | null;
          response_patterns?: Json | null;
          response_rate_percent?: number | null;
          sample_count?: number | null;
          sample_responses?: Json | null;
          signoff_patterns?: Json | null;
          signoff_style?: string | null;
          style_confidence?: number | null;
          style_summary?: string | null;
          tone?: string | null;
          tone_descriptors?: string[] | null;
          total_pairs_analyzed?: number | null;
          updated_at?: string | null;
          uses_emojis?: boolean | null;
          uses_exclamations?: boolean | null;
          warmth_level?: number | null;
          workspace_id?: string | null;
        };
        Update: {
          analysis_status?: string | null;
          average_length?: number | null;
          avg_response_length?: number | null;
          avg_response_time_minutes?: number | null;
          avg_sentences?: number | null;
          avg_words_per_sentence?: number | null;
          avoided_words?: string[] | null;
          booking_confirmation_style?: string | null;
          channel_adjustments?: Json | null;
          closing_style?: string | null;
          common_phrases?: Json | null;
          created_at?: string | null;
          directness_level?: number | null;
          emails_analyzed?: number | null;
          emoji_frequency?: string | null;
          example_responses?: Json | null;
          examples?: Json | null;
          examples_count?: number | null;
          exclamation_frequency?: number | null;
          formality_level?: number | null;
          formality_score?: number | null;
          greeting_patterns?: Json | null;
          greeting_style?: string | null;
          id?: string;
          ignore_patterns?: Json | null;
          last_analyzed_at?: string | null;
          learnings?: string[] | null;
          objection_handling_style?: string | null;
          outbound_emails_found?: number | null;
          personality_traits?: Json | null;
          price_mention_style?: string | null;
          psychological_profile?: Json | null;
          reply_triggers?: Json | null;
          response_patterns?: Json | null;
          response_rate_percent?: number | null;
          sample_count?: number | null;
          sample_responses?: Json | null;
          signoff_patterns?: Json | null;
          signoff_style?: string | null;
          style_confidence?: number | null;
          style_summary?: string | null;
          tone?: string | null;
          tone_descriptors?: string[] | null;
          total_pairs_analyzed?: number | null;
          updated_at?: string | null;
          uses_emojis?: boolean | null;
          uses_exclamations?: boolean | null;
          warmth_level?: number | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'voice_profiles_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: true;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      voicemail_transcripts: {
        Row: {
          audio_url: string;
          caller_sentiment: string | null;
          duration_seconds: number | null;
          extracted_info: Json | null;
          id: string;
          message_id: string | null;
          processed_at: string | null;
          suggested_response: string | null;
          summary: string | null;
          transcript: string | null;
          workspace_id: string;
        };
        Insert: {
          audio_url: string;
          caller_sentiment?: string | null;
          duration_seconds?: number | null;
          extracted_info?: Json | null;
          id?: string;
          message_id?: string | null;
          processed_at?: string | null;
          suggested_response?: string | null;
          summary?: string | null;
          transcript?: string | null;
          workspace_id: string;
        };
        Update: {
          audio_url?: string;
          caller_sentiment?: string | null;
          duration_seconds?: number | null;
          extracted_info?: Json | null;
          id?: string;
          message_id?: string | null;
          processed_at?: string | null;
          suggested_response?: string | null;
          summary?: string | null;
          transcript?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'voicemail_transcripts_message_id_fkey';
            columns: ['message_id'];
            isOneToOne: false;
            referencedRelation: 'messages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'voicemail_transcripts_message_id_fkey';
            columns: ['message_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['inbound_id'];
          },
          {
            foreignKeyName: 'voicemail_transcripts_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      webhook_logs: {
        Row: {
          conversation_id: string | null;
          created_at: string | null;
          direction: string;
          error_message: string | null;
          id: string;
          payload: Json | null;
          response_payload: Json | null;
          retry_count: number | null;
          status_code: number | null;
          webhook_url: string | null;
          workspace_id: string | null;
        };
        Insert: {
          conversation_id?: string | null;
          created_at?: string | null;
          direction: string;
          error_message?: string | null;
          id?: string;
          payload?: Json | null;
          response_payload?: Json | null;
          retry_count?: number | null;
          status_code?: number | null;
          webhook_url?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          conversation_id?: string | null;
          created_at?: string | null;
          direction?: string;
          error_message?: string | null;
          id?: string;
          payload?: Json | null;
          response_payload?: Json | null;
          retry_count?: number | null;
          status_code?: number | null;
          webhook_url?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'webhook_logs_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'bb_needs_classification';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'webhook_logs_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'webhook_logs_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'training_pairs';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'webhook_logs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      website_scrape_jobs: {
        Row: {
          business_info: Json | null;
          completed_at: string | null;
          error_message: string | null;
          faqs_extracted: number | null;
          ground_truth_facts: number | null;
          id: string;
          map_job_id: string | null;
          pages_extracted: number | null;
          pages_found: number | null;
          pages_scraped: number | null;
          priority_pages: string[] | null;
          retry_count: number | null;
          scrape_job_id: string | null;
          scraped_pages: Json | null;
          search_keywords: string[] | null;
          started_at: string | null;
          status: string | null;
          updated_at: string | null;
          voice_profile: Json | null;
          website_url: string;
          workspace_id: string;
        };
        Insert: {
          business_info?: Json | null;
          completed_at?: string | null;
          error_message?: string | null;
          faqs_extracted?: number | null;
          ground_truth_facts?: number | null;
          id?: string;
          map_job_id?: string | null;
          pages_extracted?: number | null;
          pages_found?: number | null;
          pages_scraped?: number | null;
          priority_pages?: string[] | null;
          retry_count?: number | null;
          scrape_job_id?: string | null;
          scraped_pages?: Json | null;
          search_keywords?: string[] | null;
          started_at?: string | null;
          status?: string | null;
          updated_at?: string | null;
          voice_profile?: Json | null;
          website_url: string;
          workspace_id: string;
        };
        Update: {
          business_info?: Json | null;
          completed_at?: string | null;
          error_message?: string | null;
          faqs_extracted?: number | null;
          ground_truth_facts?: number | null;
          id?: string;
          map_job_id?: string | null;
          pages_extracted?: number | null;
          pages_found?: number | null;
          pages_scraped?: number | null;
          priority_pages?: string[] | null;
          retry_count?: number | null;
          scrape_job_id?: string | null;
          scraped_pages?: Json | null;
          search_keywords?: string[] | null;
          started_at?: string | null;
          status?: string | null;
          updated_at?: string | null;
          voice_profile?: Json | null;
          website_url?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'website_scrape_jobs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      weekly_insights: {
        Row: {
          ai_handled_count: number | null;
          avg_confidence: number | null;
          avg_response_time_hours: number | null;
          generated_at: string | null;
          human_handled_count: number | null;
          id: string;
          notification_sent: boolean | null;
          notification_sent_at: string | null;
          performance_highlights: Json | null;
          recurring_issues: Json | null;
          suggested_faqs: Json | null;
          total_conversations: number | null;
          trending_questions: Json | null;
          upsell_opportunities: Json | null;
          vs_previous_week: Json | null;
          week_end: string;
          week_start: string;
          workspace_id: string;
        };
        Insert: {
          ai_handled_count?: number | null;
          avg_confidence?: number | null;
          avg_response_time_hours?: number | null;
          generated_at?: string | null;
          human_handled_count?: number | null;
          id?: string;
          notification_sent?: boolean | null;
          notification_sent_at?: string | null;
          performance_highlights?: Json | null;
          recurring_issues?: Json | null;
          suggested_faqs?: Json | null;
          total_conversations?: number | null;
          trending_questions?: Json | null;
          upsell_opportunities?: Json | null;
          vs_previous_week?: Json | null;
          week_end: string;
          week_start: string;
          workspace_id: string;
        };
        Update: {
          ai_handled_count?: number | null;
          avg_confidence?: number | null;
          avg_response_time_hours?: number | null;
          generated_at?: string | null;
          human_handled_count?: number | null;
          id?: string;
          notification_sent?: boolean | null;
          notification_sent_at?: string | null;
          performance_highlights?: Json | null;
          recurring_issues?: Json | null;
          suggested_faqs?: Json | null;
          total_conversations?: number | null;
          trending_questions?: Json | null;
          upsell_opportunities?: Json | null;
          vs_previous_week?: Json | null;
          week_end?: string;
          week_start?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'weekly_insights_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      workspace_channels: {
        Row: {
          automation_level: string | null;
          channel: string;
          config: Json | null;
          created_at: string | null;
          enabled: boolean | null;
          id: string;
          updated_at: string | null;
          workspace_id: string | null;
        };
        Insert: {
          automation_level?: string | null;
          channel: string;
          config?: Json | null;
          created_at?: string | null;
          enabled?: boolean | null;
          id?: string;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          automation_level?: string | null;
          channel?: string;
          config?: Json | null;
          created_at?: string | null;
          enabled?: boolean | null;
          id?: string;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'workspace_channels_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      workspace_credentials: {
        Row: {
          access_token: string | null;
          id: string;
          provider: string;
          refresh_token: string | null;
          updated_at: string | null;
          workspace_id: string;
        };
        Insert: {
          access_token?: string | null;
          id?: string;
          provider: string;
          refresh_token?: string | null;
          updated_at?: string | null;
          workspace_id: string;
        };
        Update: {
          access_token?: string | null;
          id?: string;
          provider?: string;
          refresh_token?: string | null;
          updated_at?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'workspace_credentials_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      workspace_deletion_requests: {
        Row: {
          completed_at: string | null;
          confirmed_at: string | null;
          created_at: string | null;
          export_completed: boolean | null;
          export_url: string | null;
          id: string;
          reason: string | null;
          requested_at: string | null;
          requested_by: string;
          scheduled_for: string | null;
          status: string | null;
          updated_at: string | null;
          workspace_id: string;
        };
        Insert: {
          completed_at?: string | null;
          confirmed_at?: string | null;
          created_at?: string | null;
          export_completed?: boolean | null;
          export_url?: string | null;
          id?: string;
          reason?: string | null;
          requested_at?: string | null;
          requested_by: string;
          scheduled_for?: string | null;
          status?: string | null;
          updated_at?: string | null;
          workspace_id: string;
        };
        Update: {
          completed_at?: string | null;
          confirmed_at?: string | null;
          created_at?: string | null;
          export_completed?: boolean | null;
          export_url?: string | null;
          id?: string;
          reason?: string | null;
          requested_at?: string | null;
          requested_by?: string;
          scheduled_for?: string | null;
          status?: string | null;
          updated_at?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'workspace_deletion_requests_requested_by_fkey';
            columns: ['requested_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'workspace_deletion_requests_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      workspace_gdpr_settings: {
        Row: {
          company_address: string | null;
          company_legal_name: string | null;
          created_at: string | null;
          custom_privacy_policy: string | null;
          data_protection_officer_email: string | null;
          dpa_accepted_at: string | null;
          dpa_accepted_by: string | null;
          dpa_version: string | null;
          id: string;
          privacy_policy_url: string | null;
          sub_processors: Json | null;
          updated_at: string | null;
          workspace_id: string;
        };
        Insert: {
          company_address?: string | null;
          company_legal_name?: string | null;
          created_at?: string | null;
          custom_privacy_policy?: string | null;
          data_protection_officer_email?: string | null;
          dpa_accepted_at?: string | null;
          dpa_accepted_by?: string | null;
          dpa_version?: string | null;
          id?: string;
          privacy_policy_url?: string | null;
          sub_processors?: Json | null;
          updated_at?: string | null;
          workspace_id: string;
        };
        Update: {
          company_address?: string | null;
          company_legal_name?: string | null;
          created_at?: string | null;
          custom_privacy_policy?: string | null;
          data_protection_officer_email?: string | null;
          dpa_accepted_at?: string | null;
          dpa_accepted_by?: string | null;
          dpa_version?: string | null;
          id?: string;
          privacy_policy_url?: string | null;
          sub_processors?: Json | null;
          updated_at?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'workspace_gdpr_settings_dpa_accepted_by_fkey';
            columns: ['dpa_accepted_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'workspace_gdpr_settings_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: true;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      workspace_members: {
        Row: {
          created_at: string | null;
          id: string;
          invited_at: string | null;
          invited_by: string | null;
          joined_at: string | null;
          role: string;
          updated_at: string | null;
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          invited_at?: string | null;
          invited_by?: string | null;
          joined_at?: string | null;
          role?: string;
          updated_at?: string | null;
          user_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          invited_at?: string | null;
          invited_by?: string | null;
          joined_at?: string | null;
          role?: string;
          updated_at?: string | null;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'workspace_members_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      workspace_addons: {
        Row: {
          addon_key: string;
          created_at: string;
          ended_at: string | null;
          id: string;
          metadata: Json;
          quantity: number;
          started_at: string;
          status: string;
          stripe_price_id: string | null;
          stripe_subscription_item_id: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          addon_key: string;
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          metadata?: Json;
          quantity?: number;
          started_at?: string;
          status?: string;
          stripe_price_id?: string | null;
          stripe_subscription_item_id?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          addon_key?: string;
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          metadata?: Json;
          quantity?: number;
          started_at?: string;
          status?: string;
          stripe_price_id?: string | null;
          stripe_subscription_item_id?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'workspace_addons_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      workspace_subscriptions: {
        Row: {
          cancel_at_period_end: boolean;
          created_at: string;
          current_period_end: string | null;
          current_period_start: string | null;
          id: string;
          metadata: Json;
          plan_key: string;
          status: string;
          stripe_customer_id: string | null;
          stripe_price_id: string | null;
          stripe_subscription_id: string | null;
          trial_ends_at: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          id?: string;
          metadata?: Json;
          plan_key: string;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_price_id?: string | null;
          stripe_subscription_id?: string | null;
          trial_ends_at?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          id?: string;
          metadata?: Json;
          plan_key?: string;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_price_id?: string | null;
          stripe_subscription_id?: string | null;
          trial_ends_at?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'workspace_subscriptions_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: true;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      workspaces: {
        Row: {
          business_days: number[] | null;
          business_hours_end: string | null;
          business_hours_start: string | null;
          business_type: string | null;
          core_services: string[] | null;
          created_at: string | null;
          hiring_mode: boolean | null;
          id: string;
          name: string;
          owner_id: string | null;
          slug: string;
          timezone: string | null;
          vip_domains: string[] | null;
        };
        Insert: {
          business_days?: number[] | null;
          business_hours_end?: string | null;
          business_hours_start?: string | null;
          business_type?: string | null;
          core_services?: string[] | null;
          created_at?: string | null;
          hiring_mode?: boolean | null;
          id?: string;
          name: string;
          owner_id?: string | null;
          slug: string;
          timezone?: string | null;
          vip_domains?: string[] | null;
        };
        Update: {
          business_days?: number[] | null;
          business_hours_end?: string | null;
          business_hours_start?: string | null;
          business_type?: string | null;
          core_services?: string[] | null;
          created_at?: string | null;
          hiring_mode?: boolean | null;
          id?: string;
          name?: string;
          owner_id?: string | null;
          slug?: string;
          timezone?: string | null;
          vip_domains?: string[] | null;
        };
        Relationships: [];
      };
    };
    Views: {
      bb_needs_classification: {
        Row: {
          channel: string | null;
          conversation_id: string | null;
          last_classified_message_id: string | null;
          last_classify_enqueued_message_id: string | null;
          last_inbound_message_id: string | null;
          status: string | null;
          updated_at: string | null;
          workspace_id: string | null;
        };
        Insert: {
          channel?: string | null;
          conversation_id?: string | null;
          last_classified_message_id?: string | null;
          last_classify_enqueued_message_id?: string | null;
          last_inbound_message_id?: string | null;
          status?: string | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          channel?: string | null;
          conversation_id?: string | null;
          last_classified_message_id?: string | null;
          last_classify_enqueued_message_id?: string | null;
          last_inbound_message_id?: string | null;
          status?: string | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'conversations_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      bb_open_incidents: {
        Row: {
          context: Json | null;
          created_at: string | null;
          error: string | null;
          id: string | null;
          run_id: string | null;
          scope: string | null;
          severity: string | null;
          workspace_id: string | null;
        };
        Insert: {
          context?: Json | null;
          created_at?: string | null;
          error?: string | null;
          id?: string | null;
          run_id?: string | null;
          scope?: string | null;
          severity?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          context?: Json | null;
          created_at?: string | null;
          error?: string | null;
          id?: string | null;
          run_id?: string | null;
          scope?: string | null;
          severity?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'pipeline_incidents_run_id_fkey';
            columns: ['run_id'];
            isOneToOne: false;
            referencedRelation: 'bb_pipeline_progress';
            referencedColumns: ['run_id'];
          },
          {
            foreignKeyName: 'pipeline_incidents_run_id_fkey';
            columns: ['run_id'];
            isOneToOne: false;
            referencedRelation: 'pipeline_runs';
            referencedColumns: ['id'];
          },
        ];
      };
      bb_pipeline_progress: {
        Row: {
          channel: string | null;
          classified_events: number | null;
          completed_at: string | null;
          config_id: string | null;
          decided_events: number | null;
          drafted_events: number | null;
          failed_events: number | null;
          heartbeat_age: string | null;
          last_error: string | null;
          last_heartbeat_at: string | null;
          materialized_events: number | null;
          metrics: Json | null;
          mode: string | null;
          received_events: number | null;
          run_id: string | null;
          started_at: string | null;
          state: string | null;
          total_events: number | null;
          workspace_id: string | null;
        };
        Relationships: [];
      };
      bb_queue_depths: {
        Row: {
          queue_name: string | null;
          visible_messages: number | null;
        };
        Relationships: [];
      };
      bb_stalled_events: {
        Row: {
          age: string | null;
          channel: string | null;
          config_id: string | null;
          created_at: string | null;
          external_id: string | null;
          id: string | null;
          run_id: string | null;
          status: string | null;
          thread_id: string | null;
          updated_at: string | null;
          workspace_id: string | null;
        };
        Insert: {
          age?: never;
          channel?: string | null;
          config_id?: string | null;
          created_at?: string | null;
          external_id?: string | null;
          id?: string | null;
          run_id?: string | null;
          status?: string | null;
          thread_id?: string | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          age?: never;
          channel?: string | null;
          config_id?: string | null;
          created_at?: string | null;
          external_id?: string | null;
          id?: string | null;
          run_id?: string | null;
          status?: string | null;
          thread_id?: string | null;
          updated_at?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'message_events_run_id_fkey';
            columns: ['run_id'];
            isOneToOne: false;
            referencedRelation: 'bb_pipeline_progress';
            referencedColumns: ['run_id'];
          },
          {
            foreignKeyName: 'message_events_run_id_fkey';
            columns: ['run_id'];
            isOneToOne: false;
            referencedRelation: 'pipeline_runs';
            referencedColumns: ['id'];
          },
        ];
      };
      competitor_market_intelligence: {
        Row: {
          avg_distance: number | null;
          avg_quality_score: number | null;
          avg_rating: number | null;
          avg_reviews: number | null;
          from_places: number | null;
          from_serp: number | null;
          high_priority: number | null;
          job_id: string | null;
          low_priority: number | null;
          medium_priority: number | null;
          total_competitors: number | null;
          verified_count: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'competitor_sites_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'competitor_research_jobs';
            referencedColumns: ['id'];
          },
        ];
      };
      conversion_speed: {
        Row: {
          avg_hours_to_signup: number | null;
          median_hours_to_signup: number | null;
        };
        Relationships: [];
      };
      lead_stats: {
        Row: {
          awaiting_signup: number | null;
          conversion_rate: number | null;
          in_chase_sequence: number | null;
          this_month: number | null;
          this_week: number | null;
          today: number | null;
          total_converted: number | null;
        };
        Relationships: [];
      };
      revenue_pipeline: {
        Row: {
          annual_value: number | null;
          lead_count: number | null;
          status: string | null;
        };
        Relationships: [];
      };
      training_pairs: {
        Row: {
          conversation_id: string | null;
          customer_text: string | null;
          inbound_id: string | null;
          owner_text: string | null;
          response_hours: number | null;
          subject: string | null;
          workspace_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'conversations_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      bb_cleanup_old_queue_jobs: { Args: never; Returns: Json };
      bb_ingest_unified_messages: {
        Args: {
          p_channel: string;
          p_config_id: string;
          p_messages: Json;
          p_run_id: string;
          p_workspace_id: string;
        };
        Returns: {
          enqueued_count: number;
          received_count: number;
          run_id: string;
        }[];
      };
      bb_materialize_event: {
        Args: { p_event_id: string };
        Returns: {
          channel: string;
          config_id: string;
          conversation_id: string;
          did_work: boolean;
          message_id: string;
          needs_classify: boolean;
          run_id: string;
          target_message_id: string;
          workspace_id: string;
        }[];
      };
      bb_merge_customers: {
        Args: {
          p_loser_id: string;
          p_winner_id: string;
          p_workspace_id: string;
        };
        Returns: Json;
      };
      bb_norm_identifier: {
        Args: { p_type: string; p_value: string };
        Returns: string;
      };
      bb_purge_archived_queues: { Args: never; Returns: Json };
      bb_queue_archive: {
        Args: { msg_id: number; queue_name: string };
        Returns: boolean;
      };
      bb_queue_delete: {
        Args: { msg_id: number; queue_name: string };
        Returns: boolean;
      };
      bb_queue_read: {
        Args: { n: number; queue_name: string; vt_seconds: number };
        Returns: {
          enqueued_at: string;
          message: Json;
          msg_id: number;
          read_ct: number;
          vt: string;
        }[];
      };
      bb_queue_send: {
        Args: { delay_seconds?: number; message: Json; queue_name: string };
        Returns: number;
      };
      bb_queue_send_batch: {
        Args: { delay_seconds?: number; messages: Json[]; queue_name: string };
        Returns: number[];
      };
      bb_queue_visible_count: {
        Args: { p_queue_name: string };
        Returns: number;
      };
      bb_record_incident: {
        Args: {
          p_context?: Json;
          p_error: string;
          p_run_id: string;
          p_scope: string;
          p_severity: string;
          p_workspace_id: string;
        };
        Returns: string;
      };
      bb_schedule_pipeline_crons: { Args: never; Returns: undefined };
      bb_touch_pipeline_run: {
        Args: {
          p_last_error?: string;
          p_mark_completed?: boolean;
          p_metrics_patch?: Json;
          p_run_id: string;
          p_state?: string;
        };
        Returns: undefined;
      };
      bb_trigger_worker: {
        Args: { p_body?: Json; p_url_secret_name: string };
        Returns: number;
      };
      bb_try_timestamptz: { Args: { p_value: string }; Returns: string };
      bb_unschedule_pipeline_crons: { Args: never; Returns: number };
      bb_user_in_workspace: {
        Args: { p_workspace_id: string };
        Returns: boolean;
      };
      bb_wake_worker: {
        Args: { p_url_secret_name: string };
        Returns: undefined;
      };
      create_workspace_and_join:
        | { Args: { workspace_name: string }; Returns: Json }
        | {
            Args: { business_type?: string; workspace_name: string };
            Returns: Json;
          };
      decrypt_token: {
        Args: { encrypted_token: string; secret: string };
        Returns: string;
      };
      encrypt_token: {
        Args: { secret: string; token: string };
        Returns: string;
      };
      get_meta_decrypted_token: {
        Args: { p_config_id: string };
        Returns: string;
      };
      get_my_workspace_id: { Args: never; Returns: string };
      has_role: {
        Args: {
          _role: Database['public']['Enums']['app_role'];
          _user_id: string;
        };
        Returns: boolean;
      };
      increment_emails_received: {
        Args: { p_workspace_id: string };
        Returns: undefined;
      };
      match_conversations: {
        Args: {
          match_count?: number;
          match_threshold?: number;
          query_embedding: string;
        };
        Returns: {
          ai_draft_response: string;
          confidence: number;
          customer_satisfaction: number;
          final_response: string;
          human_edited: boolean;
          id: string;
          led_to_booking: boolean;
          mode: string;
          similarity: number;
          text: string;
        }[];
      };
      match_faqs: {
        Args: {
          match_count?: number;
          match_threshold?: number;
          match_workspace_id: string;
          query_embedding: string;
        };
        Returns: {
          answer: string;
          id: string;
          priority: number;
          question: string;
          similarity: number;
          source: string;
        }[];
      };
      match_faqs_with_priority: {
        Args: {
          match_count?: number;
          match_threshold?: number;
          p_workspace_id: string;
          query_embedding: string;
        };
        Returns: {
          answer: string;
          category: string;
          id: string;
          is_own_content: boolean;
          priority: number;
          question: string;
          similarity: number;
        }[];
      };
      search_faqs_with_priority: {
        Args: {
          p_embedding: string;
          p_match_count?: number;
          p_match_threshold?: number;
          p_workspace_id: string;
        };
        Returns: {
          answer: string;
          category: string;
          id: string;
          priority: number;
          question: string;
          similarity: number;
        }[];
      };
      store_encrypted_token: {
        Args: {
          p_access_token: string;
          p_config_id: string;
          p_refresh_token?: string;
        };
        Returns: undefined;
      };
      store_meta_encrypted_token: {
        Args: { p_config_id: string; p_page_access_token: string };
        Returns: undefined;
      };
      upsert_ai_phone_usage: {
        Args: {
          p_calls?: number;
          p_cost_cents?: number;
          p_minutes?: number;
          p_month: string;
          p_workspace_id: string;
        };
        Returns: undefined;
      };
      user_has_workspace_access: {
        Args: { check_workspace_id: string };
        Returns: boolean;
      };
      user_is_workspace_admin: {
        Args: { check_workspace_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      app_role: 'admin' | 'manager' | 'reviewer';
      message_channel: 'sms' | 'whatsapp' | 'email' | 'phone' | 'webchat';
      message_status: 'pending' | 'in_progress' | 'responded' | 'escalated';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ['admin', 'manager', 'reviewer'],
      message_channel: ['sms', 'whatsapp', 'email', 'phone', 'webchat'],
      message_status: ['pending', 'in_progress', 'responded', 'escalated'],
    },
  },
} as const;
