import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { DatabaseService } from '../database/database.service.js';
import { UpdateDocumentDto } from '../dto/update_document.dto.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';

interface StoredSubtitle {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  version: number;
  last_modified_device_id?: string;
}

type NotebookSubtitles = Record<string, StoredSubtitle>;

@Injectable()
export class DocumentMergeService {
  private readonly logger = new Logger(DocumentMergeService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async merge(
  dto: UpdateDocumentDto,
  requestId: string,
  deviceId: string,
) {
  const documentId = dto.uuid;

  return this.idempotencyService.executeIdempotently(
    requestId,
    documentId,
    deviceId,
    dto,
    async () => {
      const { data: existingDocument, error: fetchError } =
        await this.databaseService.supabase
          .from('documents')
          .select('*')
          .eq('id', documentId)
          .maybeSingle();

      if (fetchError) {
        throw new InternalServerErrorException(fetchError.message);
      }

      if (!existingDocument) {
        throw new NotFoundException(
          `Notebook ${documentId} was not found`,
        );
      }

      const existingSubtitles =
        (existingDocument.subtitles ?? {}) as NotebookSubtitles;

      const mergedSubtitles: NotebookSubtitles = {
        ...existingSubtitles,
      };

      const added: string[] = [];
      const updated: string[] = [];
      const unchanged: string[] = [];
      const stale: string[] = [];

      const conflicts: Array<Record<string, unknown>> = [];

      const now = new Date().toISOString();

      for (const incoming of dto.subtitles) {
        const current = mergedSubtitles[incoming.id];

        // Case A: New subtitle.
        if (!current) {
          mergedSubtitles[incoming.id] = {
            id: incoming.id,
            title: incoming.title,
            content: incoming.content,
            created_at: now,
            updated_at: now,
            version: incoming.version,
            last_modified_device_id: deviceId,
          };

          added.push(incoming.id);
          continue;
        }

        // Case B: Incoming version is newer.
        if (incoming.version > current.version) {
          mergedSubtitles[incoming.id] = {
            ...current,
            title: incoming.title,
            content: incoming.content,
            version: incoming.version,
            updated_at: now,
            last_modified_device_id: deviceId,
          };

          updated.push(incoming.id);
          continue;
        }

        // Case C: Incoming version is older.
        if (incoming.version < current.version) {
          stale.push(incoming.id);
          continue;
        }

        // Case D: Equal versions and identical content.
        if (
          incoming.content === current.content &&
          incoming.title === current.title
        ) {
          unchanged.push(incoming.id);
          continue;
        }

        // Case E: Equal versions but different content.
        conflicts.push({
          subtitleId: incoming.id,
          reason: 'Concurrent edits detected',
          version: current.version,
          existingContent: current.content,
          incomingContent: incoming.content,
          existingDeviceId: current.last_modified_device_id ?? null,
          incomingDeviceId: deviceId,
        });
      }

      // Handle document title changes.
      const nextTitle =
        dto.title?.trim() || existingDocument.title;

      const titleChanged =
        nextTitle !== existingDocument.title;

      const hasChanges =
        added.length > 0 ||
        updated.length > 0 ||
        titleChanged;

      if (!hasChanges) {
        return {
          message:
            conflicts.length > 0
              ? 'Merge completed with unresolved conflicts'
              : 'No changes required',
          documentId,
          documentVersion: existingDocument.version,
          deviceId,
          added,
          updated,
          unchanged,
          stale,
          conflicts,
          data: existingDocument,
        };
      }

      const nextDocumentVersion =
        (existingDocument.version ?? 1) + 1;

      // Optimistic concurrency control.
      const { data: updatedDocument, error: updateError } =
        await this.databaseService.supabase
          .from('documents')
          .update({
            title: nextTitle,
            subtitles: mergedSubtitles,
            version: nextDocumentVersion,
            updated_at: now,
          })
          .eq('id', documentId)
          .eq('version', existingDocument.version)
          .select()
          .maybeSingle();

      if (updateError) {
        throw new InternalServerErrorException(updateError.message);
      }

      if (!updatedDocument) {
        throw new ConflictException(
          'Document was modified by another request. Fetch the latest version and retry.',
        );
      }

      // Save complete notebook snapshot.
      const { error: historyError } =
        await this.databaseService.supabase
          .from('document_versions')
          .insert({
            document_id: documentId,
            version_number: nextDocumentVersion,
            title: nextTitle,
            subtitles: mergedSubtitles,
          });

      if (historyError) {
        throw new InternalServerErrorException(
          historyError.message,
        );
      }

      return {
        message:
          conflicts.length > 0
            ? 'Merge completed with unresolved conflicts'
            : 'Merge completed successfully',
        documentId,
        documentVersion: nextDocumentVersion,
        deviceId,
        added,
        updated,
        unchanged,
        stale,
        conflicts,
        data: updatedDocument,
      };
    },
  );
}
}