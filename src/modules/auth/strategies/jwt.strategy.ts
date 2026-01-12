import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

/**
 * JWT Strategy
 * - Validates JWT tokens issued by our backend (NOT Auth0)
 * - Extracts userId and orgId from token payload
 * - Attaches user object to request
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('database.jwtSecret') || 'default-secret',
    });
  }

  /**
   * Validates JWT payload
   * Payload structure: { userId, orgId, iat, exp }
   */
  async validate(payload: any) {
    if (!payload.userId || !payload.orgId) {
      this.logger.warn('Invalid JWT payload: missing userId or orgId');
      throw new UnauthorizedException('Invalid token payload');
    }

    // This object is attached to request.user
    return {
      userId: payload.userId,
      orgId: payload.orgId,
    };
  }
}
