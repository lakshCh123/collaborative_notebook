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

type MergeStatus =
  | 'merged'
  | 'conflict'
  | 'unchanged';

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

          // ----------------------------------------
          // CASE 1: New subtitle
          // ----------------------------------------

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

          // ----------------------------------------
          // CASE 2: Missing base information
          // ----------------------------------------

          if (
            incoming.base_title === undefined ||
            incoming.base_content === undefined
          ) {
            conflicts.push({
              subtitleId: incoming.id,
              reason: 'Missing base values for field-level merge',
              currentVersion: current.version,
              baseVersion: incoming.base_version,
              incomingDeviceId: deviceId,
            });

            continue;
          }

          // ----------------------------------------
          // CASE 3: Future base version
          // ----------------------------------------

          if (incoming.base_version > current.version) {
            conflicts.push({
              subtitleId: incoming.id,
              reason: 'Invalid future base version',
              currentVersion: current.version,
              baseVersion: incoming.base_version,
              incomingDeviceId: deviceId,
            });

            continue;
          }

          // ----------------------------------------
          // Detect client changes
          // ----------------------------------------

          const clientChangedTitle =
            incoming.title !== incoming.base_title;

          const clientChangedContent =
            incoming.content !== incoming.base_content;

          // ----------------------------------------
          // Detect server changes
          // ----------------------------------------

          const serverChangedTitle =
            current.title !== incoming.base_title;

          const serverChangedContent =
            current.content !== incoming.base_content;

          let nextTitle = current.title;
          let nextContent = current.content;

          const fieldConflicts: Array<Record<string, unknown>> = [];

          // ----------------------------------------
          // TITLE MERGE
          // ----------------------------------------

          if (clientChangedTitle) {
            if (
              !serverChangedTitle ||
              incoming.title === current.title
            ) {
              nextTitle = incoming.title;
            } else {
              fieldConflicts.push({
                field: 'title',
                baseValue: incoming.base_title,
                currentValue: current.title,
                incomingValue: incoming.title,
                resolution: 'server_value_preserved',
              });
            }
          }

          // ----------------------------------------
          // CONTENT MERGE
          // ----------------------------------------

          if (clientChangedContent) {
            if (
              !serverChangedContent ||
              incoming.content === current.content
            ) {
              nextContent = incoming.content;
            } else {
              fieldConflicts.push({
                field: 'content',
                baseValue: incoming.base_content,
                currentValue: current.content,
                incomingValue: incoming.content,
                resolution: 'server_value_preserved',
              });
            }
          }

          // ----------------------------------------
          // Record conflicts
          // ----------------------------------------

          if (fieldConflicts.length > 0) {
            conflicts.push({
              subtitleId: incoming.id,
              reason: 'Concurrent edits to the same field',
              currentVersion: current.version,
              baseVersion: incoming.base_version,
              fields: fieldConflicts,
              existingDeviceId:
                current.last_modified_device_id ?? null,
              incomingDeviceId: deviceId,
            });
          }

          // ----------------------------------------
          // Check whether anything actually changed
          // ----------------------------------------

          const subtitleChanged =
            nextTitle !== current.title ||
            nextContent !== current.content;

          if (!subtitleChanged) {
            if (fieldConflicts.length === 0) {
              unchanged.push(incoming.id);
            }

            continue;
          }

          // ----------------------------------------
          // Save merged subtitle in memory
          // ----------------------------------------

          mergedSubtitles[incoming.id] = {
            ...current,
            title: nextTitle,
            content: nextContent,
            version: current.version + 1,
            updated_at: now,
            last_modified_device_id: deviceId,
          };

          updated.push(incoming.id);
        }

        // ----------------------------------------
        // Document title
        // ----------------------------------------

        const nextTitle =
          dto.title?.trim() || existingDocument.title;

        const titleChanged =
          nextTitle !== existingDocument.title;

        // ----------------------------------------
        // Determine whether anything changed
        // ----------------------------------------

        const hasChanges =
          added.length > 0 ||
          updated.length > 0 ||
          titleChanged;

        // ----------------------------------------
        // Nothing changed
        // ----------------------------------------

        if (!hasChanges) {
          const status: MergeStatus =
            conflicts.length > 0
              ? 'conflict'
              : 'unchanged';

          return {
            message:
              status === 'conflict'
                ? 'Merge completed with conflicts'
                : 'No changes required',

            status,

            documentId,

            documentVersion:
              existingDocument.version,

            deviceId,

            summary: {
              added: added.length,
              updated: updated.length,
              unchanged: unchanged.length,
              conflicts: conflicts.length,
            },

            added,
            updated,
            unchanged,
            conflicts,

            data: existingDocument,
          };
        }

        // ----------------------------------------
        // Calculate next document version
        // ----------------------------------------

        const nextDocumentVersion =
          (existingDocument.version ?? 1) + 1;

        // ----------------------------------------
        // Atomically update document + history
        // ----------------------------------------

        const {
          data: updatedDocument,
          error: saveError,
        } =
          await this.databaseService.supabase.rpc(
            'update_document_with_history',
            {
              p_document_id: documentId,
              p_expected_version:
                existingDocument.version,
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

        // ----------------------------------------
        // Determine final merge status
        // ----------------------------------------

        const status: MergeStatus =
          conflicts.length > 0
            ? 'conflict'
            : 'merged';

        // ----------------------------------------
        // Return explicit merge result
        // ----------------------------------------

        return {
          message:
            status === 'conflict'
              ? 'Merge completed with conflicts'
              : 'Merge completed successfully',

          status,

          documentId,

          documentVersion:
            nextDocumentVersion,

          deviceId,

          summary: {
            added: added.length,
            updated: updated.length,
            unchanged: unchanged.length,
            conflicts: conflicts.length,
          },

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