/*M!999999\- enable the sandbox mode */ 
-- MariaDB dump 10.19-11.6.2-MariaDB, for osx10.19 (arm64)
--
-- Host: localhost    Database: boc
-- ------------------------------------------------------
-- Server version	11.6.2-MariaDB

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*M!100616 SET @OLD_NOTE_VERBOSITY=@@NOTE_VERBOSITY, NOTE_VERBOSITY=0 */;

--
-- Table structure for table `trip_classes`
--

DROP TABLE IF EXISTS `trip_classes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `trip_classes` (
  `trip_class` varchar(1) NOT NULL,
  `price` float DEFAULT NULL,
  PRIMARY KEY (`trip_class`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `trip_classes`
--

LOCK TABLES `trip_classes` WRITE;
/*!40000 ALTER TABLE `trip_classes` DISABLE KEYS */;
INSERT INTO `trip_classes` VALUES
('A',5),
('B',10),
('C',15),
('D',20),
('E',25),
('F',30),
('G',35),
('H',40),
('I',45),
('J',50),
('Z',0);
/*!40000 ALTER TABLE `trip_classes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `trip_user_map`
--

DROP TABLE IF EXISTS `trip_user_map`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `trip_user_map` (
  `trip_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `trip_role` enum('Leader','Participant') NOT NULL,
  `status` enum('Signed Up','Selected','Not Selected','Attended','No Show') DEFAULT NULL,
  `need_paperwork` tinyint(1) DEFAULT NULL,
  `confirmed` tinyint(1) DEFAULT NULL,
  PRIMARY KEY (`trip_id`,`user_id`),
  KEY `fk_user_id` (`user_id`),
  CONSTRAINT `fk_trip_id` FOREIGN KEY (`trip_id`) REFERENCES `trips` (`id`),
  CONSTRAINT `fk_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `trip_user_map`
--

LOCK TABLES `trip_user_map` WRITE;
/*!40000 ALTER TABLE `trip_user_map` DISABLE KEYS */;
INSERT INTO `trip_user_map` VALUES
(1,1,'Participant','Signed Up',0,0),
(1,2,'Leader',NULL,NULL,NULL);
/*!40000 ALTER TABLE `trip_user_map` ENABLE KEYS */;
UNLOCK TABLES;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb3 */ ;
/*!50003 SET character_set_results = utf8mb3 */ ;
/*!50003 SET collation_connection  = utf8mb3_uca1400_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`zarquon`@`localhost`*/ /*!50003 TRIGGER before_insert_trip_user_map
BEFORE INSERT ON trip_user_map
FOR EACH ROW
BEGIN
IF NEW.trip_role = 'Participant' THEN
IF NEW.status IS NULL THEN SET NEW.status = 'Signed Up';
END IF;
IF NEW.need_paperwork IS NULL THEN SET NEW.need_paperwork = false;
END IF;
IF NEW.confirmed IS NULL THEN SET NEW.confirmed = false;
END IF;
END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;

--
-- Table structure for table `trips`
--

DROP TABLE IF EXISTS `trips`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `trips` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `trip_name` varchar(50) NOT NULL,
  `planned_date` datetime NOT NULL,
  `max_size` int(11) DEFAULT NULL,
  `class` varchar(1) DEFAULT NULL,
  `price_override` float DEFAULT NULL,
  `paperwork_links` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`paperwork_links`)),
  `image_links` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`image_links`)),
  `sentence_desc` varchar(100) DEFAULT NULL,
  `blurb` text DEFAULT NULL,
  `planning_checklist` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`planning_checklist`)),
  PRIMARY KEY (`id`),
  KEY `fk_class` (`class`),
  CONSTRAINT `fk_class` FOREIGN KEY (`class`) REFERENCES `trip_classes` (`trip_class`),
  CONSTRAINT `CONSTRAINT_1` CHECK (`class` is not null and `price_override` is null or `class` is null and `price_override` is not null)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `trips`
--

LOCK TABLES `trips` WRITE;
/*!40000 ALTER TABLE `trips` DISABLE KEYS */;
INSERT INTO `trips` VALUES
(1,'Willy\'s Awesome Adventure','2025-01-01 19:54:55',NULL,'Z',NULL,NULL,NULL,'Do some really awesome and cool things outside',NULL,NULL);
/*!40000 ALTER TABLE `trips` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `first_name` varchar(35) DEFAULT NULL,
  `last_name` varchar(70) DEFAULT NULL,
  `email` varchar(100) NOT NULL,
  `phone` varchar(15) DEFAULT NULL,
  `role` enum('Admin','Participant','Leader') NOT NULL,
  `lottery_weight` float DEFAULT 1,
  `has_waiver` tinyint(1) DEFAULT 0,
  `trips_lead` int(11) DEFAULT 0,
  `trips_participated` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES
(1,'William','Stone','william_l_stone@brown.edu','4043608809','Admin',1,0,0,0),
(2,'Bob','Diddly','bob_diddly@brown.edu',NULL,'Leader',1,0,0,0);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*M!100616 SET NOTE_VERBOSITY=@OLD_NOTE_VERBOSITY */;

-- Dump completed on 2025-01-01 19:59:13
