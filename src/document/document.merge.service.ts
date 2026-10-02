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

  // Existing subtitles need the original values used by the client.
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

  // A client cannot base an edit on a revision newer than the server.
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

  const clientChangedTitle =
    incoming.title !== incoming.base_title;

  const clientChangedContent =
    incoming.content !== incoming.base_content;

  const serverChangedTitle =
    current.title !== incoming.base_title;

  const serverChangedContent =
    current.content !== incoming.base_content;

  let nextTitle = current.title;
  let nextContent = current.content;

  const fieldConflicts: Array<Record<string, unknown>> = [];

  // Merge title independently.
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
      });
    }
  }

  // Merge content independently.
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
      });
    }
  }

  if (fieldConflicts.length > 0) {
    conflicts.push({
      subtitleId: incoming.id,
      reason: 'Concurrent edits to the same field',
      currentVersion: current.version,
      baseVersion: incoming.base_version,
      fields: fieldConflicts,
      existingDeviceId: current.last_modified_device_id ?? null,
      incomingDeviceId: deviceId,
    });
  }

  const subtitleChanged =
    nextTitle !== current.title ||
    nextContent !== current.content;

  if (!subtitleChanged) {
    if (fieldConflicts.length === 0) {
      unchanged.push(incoming.id);
    }

    continue;
  }

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