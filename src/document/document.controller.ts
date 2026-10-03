import {
  Controller,
  Post,
  Put,
  Body,
  Get,
  Param,
  ParseUUIDPipe,
  Headers,
  BadRequestException,
} from '@nestjs/common';

import {
  ApiTags,
  ApiOperation,
  ApiHeader,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';

import { isUUID } from 'class-validator';
import { DocumentCurrentVersionService } from './document.currentVersion.service.js';
import { DocumentCreateService } from './docomument.create.service.js';
import { DocumentMergeService } from './document.merge.service.js';
import { DocumentHistoryService } from './document.getDocumentVersions.service.js';

import { CreateDocumentDto } from '../dto/create_document.dto.js';
import { UpdateDocumentDto } from '../dto/update_document.dto.js';

@ApiTags('Documents')
@Controller('documents')
export class DocumentController {
  constructor(
  private readonly documentCreateService: DocumentCreateService,
  private readonly documentMergeService: DocumentMergeService,
  private readonly documentHistoryService: DocumentHistoryService,
  private readonly documentCurrentVersionService: DocumentCurrentVersionService,
) {}

  private validateRequestId(requestId: string): void {
    if (!requestId || !isUUID(requestId)) {
      throw new BadRequestException(
        'A valid UUID is required in the idempotency-key header',
      );
    }
  }

  private validateDeviceId(deviceId: string): void {
    if (!deviceId) {
      throw new BadRequestException(
        'x-device-id header is required',
      );
    }

    if (deviceId.length < 1 || deviceId.length > 64) {
      throw new BadRequestException(
        'x-device-id must be between 1 and 64 characters',
      );
    }
  }

  // ---------------------------------------------------------
  // CREATE DOCUMENT
  // ---------------------------------------------------------

  @Post()
  @ApiOperation({
    summary: 'Create a new document',
    description:
      'Creates a new collaborative document and stores its initial version.',
  })
  @ApiBody({
    type: CreateDocumentDto,
  })
  @ApiHeader({
    name: 'idempotency-key',
    required: true,
    description:
      'UUID used to make the request idempotent. Repeating the same request will not create another document.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiHeader({
    name: 'x-device-id',
    required: true,
    description:
      'Identifier of the device making the request. Must contain 1-64 characters.',
    example: 'laptop-01',
  })
  @ApiResponse({
    status: 201,
    description: 'Document created successfully.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid idempotency key, missing device ID, or invalid request body.',
  })
  @ApiResponse({
    status: 409,
    description:
      'A document with the same UUID already exists or an idempotency conflict occurred.',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error.',
  })
  async create(
    @Body() dto: CreateDocumentDto,
    @Headers('idempotency-key') requestId: string,
    @Headers('x-device-id') deviceId: string,
  ) {
    this.validateRequestId(requestId);
    this.validateDeviceId(deviceId);

    return this.documentCreateService.create(
      dto,
      requestId,
      deviceId,
    );
  }

  // ---------------------------------------------------------
  // MERGE / UPDATE DOCUMENT
  // ---------------------------------------------------------

  @Put()
  @ApiOperation({
    summary: 'Merge document changes',
    description:
      'Merges changes from a device into the latest document version using field-level conflict detection.',
  })
  @ApiBody({
    type: UpdateDocumentDto,
  })
  @ApiHeader({
    name: 'idempotency-key',
    required: true,
    description:
      'UUID used to make the merge request idempotent.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiHeader({
    name: 'x-device-id',
    required: true,
    description:
      'Identifier of the device making the request. Must contain 1-64 characters.',
    example: 'phone-01',
  })
  @ApiResponse({
    status: 200,
    description:
      'Document changes merged successfully.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid idempotency key, missing device ID, or invalid request body.',
  })
  @ApiResponse({
    status: 404,
    description: 'Document was not found.',
  })
  @ApiResponse({
    status: 409,
    description:
      'Document was modified by another request or a merge conflict occurred.',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error.',
  })
  async merge(
    @Body() dto: UpdateDocumentDto,
    @Headers('idempotency-key') requestId: string,
    @Headers('x-device-id') deviceId: string,
  ) {
    this.validateRequestId(requestId);
    this.validateDeviceId(deviceId);

    return this.documentMergeService.merge(
      dto,
      requestId,
      deviceId,
    );
  }
  //GETTING CURRENT DOCUMENT VERSION
@Get(':documentId')
@ApiOperation({
  summary: 'Get current document version',
  description:
    'Returns the latest version of the document.',
})
@ApiResponse({
  status: 200,
  description: 'Current document version returned successfully.',
})
@ApiResponse({
  status: 400,
  description: 'Invalid document UUID.',
})
@ApiResponse({
  status: 404,
  description: 'Document was not found.',
})
@ApiResponse({
  status: 500,
  description: 'Internal server error.',
})
async getCurrentDocument(
  @Param(
    'documentId',
    new ParseUUIDPipe(),
  )
  documentId: string,
) {
  return this.documentCurrentVersionService.getDocument(
    documentId,
  );
}
  // ---------------------------------------------------------
  // GET DOCUMENT VERSION HISTORY
  // ---------------------------------------------------------
 
   
  @Get(':documentId/versions')
  @ApiOperation({
    summary: 'Get document version history',
    description:
      'Returns all stored versions of a document, ordered from newest to oldest.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Document version history returned successfully.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid document UUID.',
  })
  @ApiResponse({
    status: 404,
    description: 'Document was not found.',
  })
  async getDocumentVersions(
    @Param(
      'documentId',
      new ParseUUIDPipe(),
    )
    documentId: string,
  ) {
    return this.documentHistoryService.getDocumentVersions(
      documentId,
    );
  }
}