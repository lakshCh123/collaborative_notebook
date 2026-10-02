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
          this.logger.error(
            `Failed to fetch document: ${fetchError.message}`,
          );

          throw new InternalServerErrorException(
            'Failed to fetch document',
          );
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
              version: 1,
              last_modified_device_id: deviceId,
            };

            added.push(incoming.id);
            continue;
          }

          // Case B: Incoming content already matches the server.
          if (
            incoming.title === current.title &&
            incoming.content === current.content
          ) {
            unchanged.push(incoming.id);
            continue;
          }

          // Case C: Client edited from the current server revision.
          if (incoming.base_version === current.version) {
            mergedSubtitles[incoming.id] = {
              ...current,
              title: incoming.title,
              content: incoming.content,
              version: current.version + 1,
              updated_at: now,
              last_modified_device_id: deviceId,
            };

            updated.push(incoming.id);
            continue;
          }

          // Case D: Client edited from an older revision.
          if (incoming.base_version < current.version) {
            conflicts.push({
              subtitleId: incoming.id,
              reason: 'Concurrent edits detected',
              version: current.version,
              baseVersion: incoming.base_version,
              existingContent: current.content,
              incomingContent: incoming.content,
              existingDeviceId:
                current.last_modified_device_id ?? null,
              incomingDeviceId: deviceId,
            });

            continue;
          }

          // Case E: Client claims a revision newer than the server has.
          conflicts.push({
            subtitleId: incoming.id,
            reason: 'Invalid future base version',
            version: current.version,
            baseVersion: incoming.base_version,
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
            conflicts,
            data: existingDocument,
          };
        }

        // Increment notebook version once for this successful merge.
        const nextDocumentVersion =
          (existingDocument.version ?? 1) + 1;

        // Atomically update the document and insert its history snapshot.
        const { data: updatedDocument, error: saveError } =
          await this.databaseService.supabase.rpc(
            'update_document_with_history',
            {
              p_document_id: documentId,
              p_expected_version: existingDocument.version,
              p_title: nextTitle,
              p_subtitles: mergedSubtitles,
              p_updated_at: now,
            },
          );

        if (saveError) {
          if (saveError.code === '40001') {
            throw new ConflictException(
              'Document was modified by another request. Fetch the latest version and retry.',
            );
          }

          this.logger.error(
            `Failed to save document and history: ${saveError.message}`,
          );

          throw new InternalServerErrorException(
            'Failed to save document and version history',
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
          conflicts,
          data: updatedDocument,
        };
      },
    );
  }
}