package com.college.placementhub.repository;

import com.college.placementhub.model.User;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface UserRepository extends MongoRepository<User, String> {
    Boolean existsByUsername(String username);
    Boolean existsByEmail(String email);

    Optional<User> findByUsername(String username);
}
