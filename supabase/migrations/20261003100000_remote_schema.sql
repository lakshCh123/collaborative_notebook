


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."assign_document_version"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    latest_version INTEGER;
BEGIN
    IF TG_OP = 'INSERT' THEN

        SELECT MAX(version_number)
        INTO latest_version
        FROM document_versions
        WHERE document_id = NEW.id;

        NEW.version := COALESCE(latest_version, 0) + 1;

    ELSIF TG_OP = 'UPDATE' THEN

        IF NEW.title IS DISTINCT FROM OLD.title
           OR NEW.subtitles IS DISTINCT FROM OLD.subtitles THEN

            SELECT MAX(version_number)
            INTO latest_version
            FROM document_versions
            WHERE document_id = NEW.id;

            NEW.version := COALESCE(latest_version, 0) + 1;

        ELSE
            NEW.version := OLD.version;
        END IF;

    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."assign_document_version"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_document_with_history"("p_document_id" "uuid", "p_expected_version" integer, "p_title" "text", "p_subtitles" "jsonb", "p_updated_at" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
declare
  updated_doc public.documents%rowtype;
  next_version integer;
begin
  next_version := p_expected_version + 1;

  update public.documents
  set
    title = p_title,
    subtitles = p_subtitles,
    version = next_version,
    updated_at = p_updated_at
  where id = p_document_id
    and version = p_expected_version
  returning * into updated_doc;

  if not found then
    raise exception 'Document version conflict'
      using errcode = '40001';
  end if;

  insert into public.document_versions (
    document_id,
    version_number,
    title,
    subtitles
  )
  values (
    p_document_id,
    next_version,
    p_title,
    p_subtitles
  );

  return to_jsonb(updated_doc);
end;
$$;


ALTER FUNCTION "public"."update_document_with_history"("p_document_id" "uuid", "p_expected_version" integer, "p_title" "text", "p_subtitles" "jsonb", "p_updated_at" timestamp with time zone) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."document_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "document_id" "uuid" NOT NULL,
    "version_number" integer NOT NULL,
    "title" "text" NOT NULL,
    "subtitles" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "device_id" "text"
);


ALTER TABLE "public"."document_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "subtitles" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "user_id" "uuid",
    "device_id" "uuid",
    CONSTRAINT "subtitles_must_be_object" CHECK (("jsonb_typeof"("subtitles") = 'object'::"text"))
);


ALTER TABLE "public"."documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sync_requests" (
    "request_id" "uuid" NOT NULL,
    "document_id" "uuid",
    "response" "jsonb",
    "processed_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'completed'::"text" NOT NULL,
    "request_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "device_id" "uuid",
    CONSTRAINT "sync_requests_status_check" CHECK (("status" = ANY (ARRAY['processing'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."sync_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."document_versions"
    ADD CONSTRAINT "document_versions_document_id_version_number_key" UNIQUE ("document_id", "version_number");



ALTER TABLE ONLY "public"."document_versions"
    ADD CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_title_key" UNIQUE ("title");



ALTER TABLE ONLY "public"."sync_requests"
    ADD CONSTRAINT "sync_requests_pkey" PRIMARY KEY ("request_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "sync_requests_created_at_idx" ON "public"."sync_requests" USING "btree" ("created_at");



ALTER TABLE ONLY "public"."document_versions"
    ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."sync_requests"
    ADD CONSTRAINT "sync_requests_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE CASCADE;



ALTER TABLE "public"."sync_requests" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_document_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."assign_document_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_document_version"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_document_with_history"("p_document_id" "uuid", "p_expected_version" integer, "p_title" "text", "p_subtitles" "jsonb", "p_updated_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."update_document_with_history"("p_document_id" "uuid", "p_expected_version" integer, "p_title" "text", "p_subtitles" "jsonb", "p_updated_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_document_with_history"("p_document_id" "uuid", "p_expected_version" integer, "p_title" "text", "p_subtitles" "jsonb", "p_updated_at" timestamp with time zone) TO "service_role";



GRANT ALL ON TABLE "public"."document_versions" TO "anon";
GRANT ALL ON TABLE "public"."document_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."document_versions" TO "service_role";



GRANT ALL ON TABLE "public"."documents" TO "anon";
GRANT ALL ON TABLE "public"."documents" TO "authenticated";
GRANT ALL ON TABLE "public"."documents" TO "service_role";



GRANT ALL ON TABLE "public"."sync_requests" TO "anon";
GRANT ALL ON TABLE "public"."sync_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."sync_requests" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







