package httpadapter

type RoomStillPlannedDetails struct {
	ActivityGroups  int `json:"activity_groups"`
	UpcomingBlocks  int `json:"upcoming_blocks"`
	EducationGroups int `json:"education_groups"`
	Devices         int `json:"devices"`
}
