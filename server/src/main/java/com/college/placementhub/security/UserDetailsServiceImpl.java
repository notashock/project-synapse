package com.college.placementhub.security;

import com.college.placementhub.model.User;
import com.college.placementhub.repository.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

@Service
public class UserDetailsServiceImpl implements UserDetailsService {
    @Autowired
    UserRepository repo;

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        User user =repo.findByUsername(username).orElseThrow(() -> new UsernameNotFoundException("User not found"));
        return UserDetailsImpl.build(user);
    }

}
