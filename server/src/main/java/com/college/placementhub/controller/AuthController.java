package com.college.placementhub.controller;

import com.college.placementhub.dto.JwtResponse;
import com.college.placementhub.dto.LoginRequest;
import com.college.placementhub.dto.SignUpRequest;
import com.college.placementhub.repository.UserRepository;
import com.college.placementhub.model.User;
import com.college.placementhub.security.JwtUtils;
import com.college.placementhub.security.UserDetailsImpl;
import com.college.placementhub.service.BlacklistService;
import com.college.placementhub.service.DeviceSessionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    @Autowired
    private UserRepository repo;
    @Autowired
    private PasswordEncoder passwordEncoder;
    @Autowired
    private AuthenticationManager authenticationManager;
    @Autowired
    private JwtUtils jwtUtils;
    @Autowired
    private BlacklistService blacklistService;
    @Autowired
    private DeviceSessionService deviceSessionService;

    @PostMapping("/register")
    public ResponseEntity<?> registerUser(@RequestBody SignUpRequest signUpRequest) {
        if (repo.existsByUsername(signUpRequest.getUsername())) {
            return ResponseEntity.badRequest().body("Username is already in use");
        }
        if (repo.existsByEmail(signUpRequest.getEmail())) {
            return ResponseEntity.badRequest().body("Email is already in use");
        }
        User user = new User();
        user.setUsername(signUpRequest.getUsername());
        user.setEmail(signUpRequest.getEmail());
        user.setPassword(passwordEncoder.encode(signUpRequest.getPassword()));
        user.setRoles(Collections.singleton("ROLE_STUDENT"));
        repo.save(user);
        return ResponseEntity.ok().build();
    }
    @PostMapping("/login")
    public ResponseEntity<?> authenticateUser(@RequestBody LoginRequest logReq){
        Authentication auth = authenticationManager.authenticate(new UsernamePasswordAuthenticationToken(logReq.getUsername(), logReq.getPassword()));
        SecurityContextHolder.getContext().setAuthentication(auth);
        String jwt = jwtUtils.generateJwtToken(auth);
        UserDetailsImpl userDetails = (UserDetailsImpl) auth.getPrincipal();
        deviceSessionService.registerNewLogin(userDetails.getUsername(), jwt);
        List<String> roles = userDetails.getAuthorities().stream().map(item -> item.getAuthority()).collect(Collectors.toList());
        return ResponseEntity.ok(new JwtResponse(
                jwt, userDetails.getId(), userDetails.getUsername(), userDetails.getEmail(), roles
        ));
    }
    @PostMapping("/logout")
    public ResponseEntity<?> logoutUser(HttpServletRequest req){
        String headerAuth = req.getHeader("Authorization");
        String jwt = null;

        if(StringUtils.hasText(headerAuth) && headerAuth.startsWith("Bearer ")){
            jwt = headerAuth.substring(7);
        }
        if (jwt != null){
            blacklistService.addToBlacklist(jwt);
            String username = jwtUtils.getUsernameFromJwtToken(jwt);
            deviceSessionService.removeTokenOnLogout(username, jwt);
            return ResponseEntity.ok("Logged Out Successfully");
        }
        return ResponseEntity.badRequest().body("Error: No token found in request.");
    }
}
