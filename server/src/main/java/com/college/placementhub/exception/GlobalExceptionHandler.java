package com.college.placementhub.exception;

import com.college.placementhub.dto.ErrorResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.LocalDateTime;

@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(BadCredentialsException.class)
    public ResponseEntity<ErrorResponse> handleBadCredentialsException(BadCredentialsException ex, HttpServletRequest req){
        ErrorResponse errRes = new ErrorResponse(LocalDateTime.now(), HttpStatus.UNAUTHORIZED.value(), "Unauthorized", "Invalid Username or Pasword", req.getRequestURI());
        return new ResponseEntity<>(errRes, HttpStatus.UNAUTHORIZED);
    }
    @ExceptionHandler(UsernameNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleUsernameNotFoundException(UsernameNotFoundException ex, HttpServletRequest req){
        ErrorResponse er = new ErrorResponse(LocalDateTime.now(),
                HttpStatus.NOT_FOUND.value(),
                "Username Not Found",
                ex.getMessage(),
                req.getRequestURI());
        return new ResponseEntity<>(er, HttpStatus.NOT_FOUND);
    }
    @ExceptionHandler(org.springframework.dao.DuplicateKeyException.class)
    public ResponseEntity<ErrorResponse> handleDuplicateKeyException(org.springframework.dao.DuplicateKeyException ex, HttpServletRequest request) {
        ErrorResponse errorResponse = new ErrorResponse(
                LocalDateTime.now(),
                HttpStatus.CONFLICT.value(),
                "Conflict",
                "A user with that information already exists.",
                request.getRequestURI()
        );
        return new ResponseEntity<>(errorResponse, HttpStatus.CONFLICT);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleGlobalException(Exception ex, HttpServletRequest request) {
        ErrorResponse errorResponse = new ErrorResponse(
                LocalDateTime.now(),
                HttpStatus.INTERNAL_SERVER_ERROR.value(),
                "Internal Server Error",
                "An unexpected error occurred. Please try again later.",
                request.getRequestURI()
        );

        // Print the actual stack trace to your console so you can debug it,
        // but the user only sees the clean JSON above.
        ex.printStackTrace();

        return new ResponseEntity<>(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
    }
}
