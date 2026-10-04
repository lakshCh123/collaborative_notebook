import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

import { createHash } from 'node:crypto';

import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);//logger for the service

  constructor(
    private readonly databaseService: DatabaseService,
  ) {} //injecting the database service

  private generateRequestHash(payload: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');//converting to hash to store the key
  }

  async executeIdempotently<T>(
    requestId: string,
    documentId: string | null,
    deviceId: string,
    payload: unknown,
    operation: () => Promise<T>,
  ): Promise<T> {
    const requestHash = this.generateRequestHash(payload);

    const { data: existingRequest, error: searchError } =
      await this.databaseService.supabase
        .from('sync_requests')
        .select('*')
        .eq('request_id', requestId)
        .maybeSingle();//checking for the key

    if (searchError) {
      throw new InternalServerErrorException(searchError.message);//if error occurs while searchign
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

        return {
          message: 'Same request already processed',
          data: existingRequest.response,
        } as T;
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
          device_id: deviceId,
          request_hash: requestHash,
          status: 'processing',
        });

    if (insertError) {
      if (insertError.code === '23505') {
        throw new ConflictException(
          'This request is already being processed',
        );
      }

      throw new InternalServerErrorException(insertError.message);//if any internal error
    }

    try {
      const result = await operation(); //this will wait for my main opertaion

      const resultDocumentId =
        result !== null &&
        typeof result === 'object' &&
        'id' in result &&
        typeof result.id === 'string'//edge checks basic result not null and stuff
          ? result.id
          : documentId;

      const { error: updateError } =
        await this.databaseService.supabase
          .from('sync_requests')
          .update({
            document_id: resultDocumentId,
            response: result,//storing the result in the response
            status: 'completed',
            processed_at: new Date().toISOString(),//assigning the processed time
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
}