package com.college.placementhub.security;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.util.Date;

@Component
public class JwtUtils {
    @Value("${placementhub.jwt.secret}")
    private String jwtSecret;

    @Value("${placementhub.jwt.expiration}")
    private int jwtExpirationMs;

    private SecretKey getSigningKey() {
        byte[] keyBytes = Decoders.BASE64.decode(jwtSecret);
        return Keys.hmacShaKeyFor(keyBytes);
    }

    public String generateJwtToken(Authentication authentication) {
        UserDetailsImpl user = (UserDetailsImpl) authentication.getPrincipal();
        return Jwts.builder().subject(user.getUsername()).issuedAt(new Date()).expiration(new Date((new Date()).getTime() + jwtExpirationMs)).signWith(getSigningKey()).compact();
    }
    public String getUsernameFromJwtToken(String token) {
        return Jwts.parser().verifyWith(getSigningKey()).build().parseSignedClaims(token).getPayload().getSubject();
    }
    public boolean validateJwtToken(String authToken){
        try{
            Jwts.parser().verifyWith(getSigningKey()).build().parseSignedClaims(authToken);
            return true;
        }catch(Exception e){
            System.err.println("Invalid token: "+ e.getMessage());
        }
        return false;
    }
}
