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
  created_at: string;//what the subtitle content will follow
  updated_at: string;
  version: number;
  last_modified_device_id?: string;
}

type NotebookSubtitles = Record<string, StoredSubtitle>;

@Injectable()
export class DocumentMergeService {
  private readonly logger = new Logger(DocumentMergeService.name);//for logging the service

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly idempotencyService: IdempotencyService,//injecting the database service and idempotency service
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

        const documentConflicts: Array< Record<string, unknown> > = [];

        const now = new Date().toISOString();

//document level three way merge
        const incomingTitle = dto.title.trim();
        const baseTitle = dto.base_title.trim();

        const clientChangedTitle =
          incomingTitle !== baseTitle;

        const serverChangedTitle =
          existingDocument.title !== baseTitle;

        let nextTitle: string = existingDocument.title;

        if (clientChangedTitle) {
          if (!serverChangedTitle || incomingTitle === existingDocument.title
          ) {
            nextTitle = incomingTitle;
          } else {
            documentConflicts.push({
              field: 'title',
              baseValue: baseTitle,
              currentValue: existingDocument.title,
              incomingValue: incomingTitle,
            });
          }
        }

//subtitle level three way merge
        for (const incoming of dto.subtitles) {
          const current = mergedSubtitles[incoming.id];

          // New subtitle
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

          // Existing subtitles require base values
          if (
            incoming.base_title === undefined ||
            incoming.base_content === undefined
          ) {
            conflicts.push({
              subtitleId: incoming.id,
              reason:
                'Missing base values for field-level merge',
              currentVersion: current.version,
              baseVersion: incoming.base_version,
              incomingDeviceId: deviceId,
            });

            continue;
          }

          // Reject future base version
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

          const clientChangedSubtitleTitle =
            incoming.title !== incoming.base_title;

          const clientChangedContent =
            incoming.content !== incoming.base_content;

          const serverChangedSubtitleTitle =
            current.title !== incoming.base_title;

          const serverChangedContent =
            current.content !== incoming.base_content;

          let nextSubtitleTitle = current.title;
          let nextContent = current.content;

          const fieldConflicts: Array< Record<string, unknown>> = [];

          // Subtitle title
          if (clientChangedSubtitleTitle) {
            if (
              !serverChangedSubtitleTitle ||incoming.title === current.title
            ) {
              nextSubtitleTitle = incoming.title;
            } else {
              fieldConflicts.push({
                field: 'title',
                baseValue: incoming.base_title,
                currentValue: current.title,
                incomingValue: incoming.title,
              });
            }
          }

          // Subtitle content
          if (clientChangedContent) {
            if (
              !serverChangedContent || incoming.content === current.content
            ) {
              nextContent = incoming.content;
            } else {
              fieldConflicts.push({
                field: 'content',
                baseValue: incoming.base_content,
                currentValue: current.content,
                incomingValue: incoming.content,
              });
            }
          }

          if (fieldConflicts.length > 0) {
            conflicts.push({
              subtitleId: incoming.id,
              reason:
                'Concurrent edits to the same field',
              currentVersion: current.version,
              baseVersion: incoming.base_version,
              fields: fieldConflicts,
              existingDeviceId:
                current.last_modified_device_id ?? null,
              incomingDeviceId: deviceId,
            });
          }

          const subtitleChanged =nextSubtitleTitle !== current.title ||nextContent !== current.content;

          if (!subtitleChanged) {
            if (fieldConflicts.length === 0) {
              unchanged.push(incoming.id);
            }

            continue;
          }

          mergedSubtitles[incoming.id] = {
            ...current,
            title: nextSubtitleTitle,
            content: nextContent,
            version: current.version + 1,
            updated_at: now,
            last_modified_device_id: deviceId,
          };

          updated.push(incoming.id);
        }
//if any real changes has happened 

        const titleChanged =
          nextTitle !== existingDocument.title;

        const hasChanges =
          added.length > 0 ||
          updated.length > 0 ||
          titleChanged;

// no changes has happened but there are conflicts so we return the conflicts without saving anything
        if (!hasChanges) {
          const hasConflicts =
            conflicts.length > 0 ||
            documentConflicts.length > 0;

          return {
            message: hasConflicts
              ? 'Merge completed with unresolved conflicts'
              : 'No changes required',

            documentId,

            documentVersion:
              existingDocument.version,

            deviceId,

            added,
            updated,
            unchanged,

            conflicts,
            documentConflicts,

            data: existingDocument,
          };
        }

//saving document history + versioning + updating the document with new changes
        const nextDocumentVersion =
          (existingDocument.version ?? 1) + 1;

        const { data: updatedDocument, error: saveError } =
          await this.databaseService.supabase.rpc(//calling supabase function to update document and save history
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
          if (saveError.code === '40001') {//postgress error code for serialization failure, which indicates a concurrent modification
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
//response to the client with the result of the merge operation including any conflicts and the updated document data
        const hasConflicts =
          conflicts.length > 0 ||
          documentConflicts.length > 0;

        return {
          message: hasConflicts
            ? 'Merge completed with unresolved conflicts'
            : 'Merge completed successfully',

          documentId,

          documentVersion:
            nextDocumentVersion,

          deviceId,

          added,
          updated,
          unchanged,

          conflicts,
          documentConflicts,

          data: updatedDocument,
        };
      },
    );
  }
}