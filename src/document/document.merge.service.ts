import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { createHash } from 'node:crypto';

import { DatabaseService } from '../database/database.service.js';
import { UpdateDocumentDto } from '../dto/update_document.dto.js';

interface StoredSubtitle {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  version: number;
}

type NotebookSubtitles = Record<string, StoredSubtitle>;

@Injectable()
export class DocumentMergeService {
  private readonly logger = new Logger(DocumentMergeService.name);

  constructor(
    private readonly databaseService: DatabaseService,
  ) {}

  private generateRequestHash(payload: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  private async executeIdempotently<T>(
    requestId: string,
    documentId: string | null,
    payload: unknown,
    operation: () => Promise<T>,
  ): Promise<T> {
    const requestHash = this.generateRequestHash(payload);

    const { data: existingRequest, error: searchError } =
      await this.databaseService.supabase
        .from('sync_requests')
        .select('*')
        .eq('request_id', requestId)
        .maybeSingle();

    if (searchError) {
      throw new InternalServerErrorException(searchError.message);
    }

    if (existingRequest) {
      if (existingRequest.request_hash !== requestHash) {
        throw new ConflictException(
          'Idempotency key reused with a different request body',
        );
      }

      if (
        existingRequest.status === 'completed' &&
        existingRequest.response !== null
      ) {
        this.logger.log(
          `Returning cached response for request ${requestId}`,
        );

        return existingRequest.response as T;
      }

      throw new ConflictException(
        'This request is already being processed or has not completed',
      );
    }

    const { error: insertError } =
      await this.databaseService.supabase
        .from('sync_requests')
        .insert({
          request_id: requestId,
          document_id: documentId,
          request_hash: requestHash,
          status: 'processing',
        });

    if (insertError) {
      if (insertError.code === '23505') {
        throw new ConflictException(
          'This request is already being processed',
        );
      }

      throw new InternalServerErrorException(insertError.message);
    }

    try {
      const result = await operation();

      const { error: updateError } =
        await this.databaseService.supabase
          .from('sync_requests')
          .update({
            response: result,
            status: 'completed',
            processed_at: new Date().toISOString(),
          })
          .eq('request_id', requestId);

      if (updateError) {
        throw new InternalServerErrorException(updateError.message);
      }

      return result;
    } catch (error) {
      await this.databaseService.supabase
        .from('sync_requests')
        .update({
          status: 'failed',
        })
        .eq('request_id', requestId);

      throw error;
    }
  }

  async merge(dto: UpdateDocumentDto, requestId: string) {
    const documentId = dto.uuid;

    return this.executeIdempotently(
      requestId,
      documentId,
      dto,
      async () => {
        // 1. Find the notebook using its UUID.
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

        // 2. Read its existing subtitles.
        const existingSubtitles =
          (existingDocument.subtitles ?? {}) as NotebookSubtitles;//array of objects

        // Make a separate object so we don't mutate the original.
        const mergedSubtitles: NotebookSubtitles = {
          ...existingSubtitles,//separting them in arrays
        };

        const added: string[] = [];
        const conflicts: Array<Record<string, unknown>> = [];
        const undecided: string[] = [];

        // 3. Compare incoming subtitles against the stored subtitles.
        for (const incoming of dto.subtitles) {
          const current = mergedSubtitles[incoming.id];

          // Case A: Subtitle ID does not exist. Add it.
          if (!current) {
            mergedSubtitles[incoming.id] = {
              id: incoming.id,
              title: incoming.title,
              content: incoming.content,
              created_at: incoming.created_at,
              updated_at:
                incoming.updated_at ?? incoming.created_at,
              version: incoming.version,
            };

            added.push(incoming.id);
            continue;
          }

          // Case B: Stored subtitle is newer. Do not overwrite it.
          if (current.version > incoming.version) {
            conflicts.push({
              subtitleId: incoming.id,
              reason: 'Newer version exists',
              incomingVersion: incoming.version,
              existingVersion: current.version,
            });
        // Equal or incoming-newer cases are intentionally undecided.
          undecided.push(incoming.id);
            continue;
          }

         if (current.version === incoming.version) {
  const incomingTimestamp = Date.parse(
    incoming.updated_at ?? incoming.created_at,
  );

  const existingTimestamp = Date.parse(current.updated_at);

  if (
    !Number.isFinite(incomingTimestamp) ||
    !Number.isFinite(existingTimestamp)
  ) {
    conflicts.push({
      subtitleId: incoming.id,
      reason: 'Invalid timestamp; existing subtitle retained',
    });

    continue;
  }

  if (incomingTimestamp > existingTimestamp) {
    mergedSubtitles[incoming.id] = {
      id: incoming.id,
      title: incoming.title,
      content: incoming.content,
      created_at: incoming.created_at,
      updated_at: incoming.updated_at ?? incoming.created_at,
      version: incoming.version,
    };

     added.push(incoming.id);
    } else {
    conflicts.push({
      subtitleId: incoming.id,
      reason: 'Existing subtitle has an equal or newer timestamp',
      incomingTimestamp: incoming.updated_at ?? incoming.created_at,
      existingTimestamp: current.updated_at,
    });
    }

    continue;
    }
        }
        

        // 4. If no new subtitles were added, do not create a new notebook version.
        if (added.length === 0) {
          return {
            message: 'No new subtitles were added',
            documentId,
            added,
            conflicts,
            undecided,
            data: existingDocument,
          };
        }

        // 5. Increment the notebook-level version.
        const nextDocumentVersion =
          (existingDocument.version ?? 1) + 1;

        const now = new Date().toISOString();

        // 6. Update the latest notebook state.
        const { data: updatedDocument, error: updateError } =
          await this.databaseService.supabase
            .from('documents')
            .update({
              subtitles: mergedSubtitles,
              version: nextDocumentVersion,
              updated_at: now,
            })
            .eq('id', documentId)
            .select()
            .single();

        if (updateError) {
          throw new InternalServerErrorException(updateError.message);
        }
    
        // 7. Save a snapshot of the updated notebook.
        const { error: historyError } =
          await this.databaseService.supabase
            .from('document_versions')
            .insert({
              document_id: documentId,
              version_number: nextDocumentVersion,
              title: existingDocument.title,
              subtitles: mergedSubtitles,
            });

        if (historyError) {
          throw new InternalServerErrorException(historyError.message);
        }

        return {
          message: 'Merge completed',
          documentId,
          documentVersion: nextDocumentVersion,
          added,
          conflicts,
          undecided,
          data: updatedDocument,
        };
      },
    );
  }
}