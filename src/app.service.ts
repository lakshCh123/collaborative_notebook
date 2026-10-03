import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return `
      <html>
        <body>
          <h1>WORKING</h1>
          <img 
            src="/images/shrek.jpg" 
            alt="Shrek"
            width="400"
          />
        </body>
      </html>
    `;
  }
}