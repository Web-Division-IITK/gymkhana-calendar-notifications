#!/bin/bash

export PASS=deven_notif_test_pushy

nohup node notif-server/index.js > serverlogs.txt &
